require 'minitest/autorun'
require 'yaml'
require 'open3'

class VisitorProfileCdnTest < Minitest::Test
  ROOT = File.expand_path('../..', __dir__)
  CONFIG = YAML.safe_load(File.read(File.join(ROOT, 'config-eds/cdn.yaml')))
  DATA = CONFIG.fetch('data')
  HOST = 'suresmile.ynaka-adobe.com'
  PATH = '/api/visitor-profile'
  BASE = '4dad2e2'
  HOSTS = %w[
    suresmile.ynaka-adobe.com granddesignrv.xsc.demo.adobe.com dupont.ynaka-adobe.com
    xsc-demo.ynaka-adobe.com fmc-dealer-communications.ynaka-adobe.com
    dealer-communications.ynaka-adobe.com parker.ynaka-adobe.com
    chevronlubricants.ynaka-adobe.com toyotafinancial.ynaka-adobe.com
    3m.ynaka-adobe.com new-demo.example.com another.customer.example
  ].freeze

  def matches?(condition, host, path, method = 'GET')
    return true if condition == '*'
    if condition.key?('allOf')
      condition.fetch('allOf').all? { |child| matches?(child, host, path, method) }
    elsif condition.key?('anyOf')
      condition.fetch('anyOf').any? { |child| matches?(child, host, path, method) }
    else
      value = { 'domain' => host, 'originalPath' => path, 'path' => path, 'method' => method }
              .fetch(condition.fetch('reqProperty'))
      if condition.key?('equals')
        value == condition.fetch('equals')
      elsif condition.key?('matches')
        Regexp.new(condition.fetch('matches')).match?(value)
      else
        !Regexp.new(condition.fetch('doesNotMatch')).match?(value)
      end
    end
  end

  def test_exact_route_and_cache_policy_for_all_methods
    route = DATA.fetch('originSelectors').fetch('rules').find { |r| r['name'] == 'route-visitor-profile' }
    assert_equal(
      { 'type' => 'selectAemOrigin', 'originName' => 'edgefunction-visitor-profile', 'skipCache' => true },
      route.fetch('action')
    )
    HOSTS.each do |host|
      %w[GET POST HEAD OPTIONS PUT DELETE].each do |method|
        first = DATA.fetch('originSelectors').fetch('rules').find do |rule|
          matches?(rule.fetch('when'), host, PATH, method)
        end
        assert_equal route, first, "#{host} #{method}"
      end
    end
    assert_equal({ 'reqProperty' => 'originalPath', 'equals' => PATH }, route.fetch('when'))
    HOSTS.each do |host|
      ['/en-us', PATH + '/', PATH + '/extra', '/api/location/doctors', '/auth/geo', '/auth/login', '/'].each do |path|
        refute matches?(route.fetch('when'), host, path)
      end
    end
    cache = DATA.fetch('responseTransformations').fetch('rules').find { |r| r['name'] == 'no-store-visitor-profile' }
    assert_equal route.fetch('when'), cache.fetch('when')
    assert_equal route.fetch('when'), DATA.fetch('requestTransformations').fetch('rules')[1].fetch('when')
    assert_equal(
      [
        { 'type' => 'set', 'respHeader' => 'Cache-Control', 'value' => 'private, no-store' },
        { 'type' => 'set', 'respHeader' => 'Surrogate-Control', 'value' => 'no-store' }
      ],
      cache.fetch('actions')
    )
  end

  def test_spoofed_internal_headers_are_removed_then_replaced_from_platform
    rules = DATA.fetch('requestTransformations').fetch('rules').first(2)
    assert_equal ['strip-visitor-profile-metadata', 'set-visitor-profile-metadata'], rules.map { |r| r['name'] }
    HOSTS.each do |host|
      ['/en-us', PATH].each do |path|
        headers = {
          'x-visitor-profile-host' => HOST, 'x-visitor-profile-ip' => '198.51.100.99',
          'x-visitor-profile-country' => 'XX',
          'x-suresmile-profile-host' => HOST, 'x-suresmile-profile-ip' => '198.51.100.99',
          'x-suresmile-profile-country' => 'XX'
        }
        properties = { 'domain' => host, 'clientIp' => '203.0.113.7', 'clientCountry' => 'US' }
        rules.each do |rule|
          next unless matches?(rule.fetch('when'), host, path)
          rule.fetch('actions').each do |action|
            key = action.fetch('reqHeader')
            if action.fetch('type') == 'unset'
              headers.delete(key)
            else
              headers[key] = properties.fetch(action.fetch('value').fetch('reqProperty'))
            end
          end
        end
        if path == PATH
          assert_equal [host, '203.0.113.7', 'US'], headers.values
        else
          assert_empty headers
        end
      end
    end
  end

  def test_only_profile_and_retired_dupont_rules_change
    yaml, status = Open3.capture2('git', 'show', "#{BASE}:config-eds/cdn.yaml", chdir: ROOT)
    assert status.success?
    original = YAML.safe_load(yaml)
    current = YAML.safe_load(File.read(File.join(ROOT, 'config-eds/cdn.yaml')))
    {
      'originSelectors' => %w[route-suresmile-visitor-profile route-visitor-profile route-persona-home],
      'requestTransformations' => %w[strip-suresmile-profile-metadata set-suresmile-profile-metadata
                                     strip-visitor-profile-metadata set-visitor-profile-metadata],
      'responseTransformations' => %w[no-store-suresmile-visitor-profile no-store-visitor-profile]
    }.each do |section, names|
      [original, current].each do |config|
        config.fetch('data').fetch(section).fetch('rules').reject! { |rule| names.include?(rule['name']) }
      end
    end
    assert_equal original, current
  end

  def test_generic_declaration_retires_legacy_functions_and_preserves_xsc_and_secrets
    yaml, status = Open3.capture2('git', 'show', "#{BASE}:config-eds/edgeFunctions.yaml", chdir: ROOT)
    assert status.success?
    current = YAML.safe_load(File.read(File.join(ROOT, 'config-eds/edgeFunctions.yaml')))
    functions = current.fetch('data').fetch('functions')
    assert_equal %w[visitor-profile xsc-demo-cug], functions.map { |function| function.fetch('name') }
    original = YAML.safe_load(yaml)
    original.fetch('data').fetch('functions').reject! { |function| function['name'] == 'dupont-persona' }
    original.fetch('data').fetch('functions').find { |function| function['name'] == 'suresmile-visitor-profile' }['name'] = 'visitor-profile'
    assert_equal original, current
  end

  def test_xsc_auth_and_geo_source_unchanged
    original, status = Open3.capture2('git', 'show', "#{BASE}:edge-functions-xsc-demo/src/index.js", chdir: ROOT)
    assert status.success?
    assert_equal original, File.read(File.join(ROOT, 'edge-functions-xsc-demo/src/index.js'))
    refute File.exist?(File.join(ROOT, 'edge-functions-xsc-demo/src/visitor-profile.js'))
  end
end
