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
    suresmile.ynaka-adobe.com 3m.ynaka-adobe.com dupont.ynaka-adobe.com
    xsc-demo.ynaka-adobe.com fmc-dealer-communications.ynaka-adobe.com
    dealer-communications.ynaka-adobe.com parker.ynaka-adobe.com
    chevronlubricants.ynaka-adobe.com toyotafinancial.ynaka-adobe.com
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
    route = DATA.fetch('originSelectors').fetch('rules').find { |r| r['name'] == 'route-suresmile-visitor-profile' }
    assert_equal(
      { 'type' => 'selectAemOrigin', 'originName' => 'edgefunction-suresmile-visitor-profile', 'skipCache' => true },
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
    [HOST + '.evil.example', 'unmanaged.ynaka-adobe.com', 'granddesignrv.ynaka-adobe.com',
     'main--suresmile--ynaka-adobe.aem.live', 'main--suresmile--ynaka-adobe.aem.page'].each do |host|
      refute matches?(route.fetch('when'), host, PATH)
    end
    HOSTS.each do |host|
      ['/en-us', PATH + '/', PATH + '/extra', '/api/location/doctors', '/auth/geo', '/auth/login', '/'].each do |path|
        refute matches?(route.fetch('when'), host, path)
      end
    end
    cache = DATA.fetch('responseTransformations').fetch('rules').find { |r| r['name'] == 'no-store-suresmile-visitor-profile' }
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
    assert_equal ['strip-suresmile-profile-metadata', 'set-suresmile-profile-metadata'], rules.map { |r| r['name'] }
    (HOSTS + ['unmanaged.ynaka-adobe.com']).each do |host|
      headers = {
        'x-suresmile-profile-host' => HOST, 'x-suresmile-profile-ip' => '198.51.100.99',
        'x-suresmile-profile-country' => 'XX'
      }
      properties = { 'domain' => host, 'clientIp' => '203.0.113.7', 'clientCountry' => 'US' }
      rules.each do |rule|
        next unless matches?(rule.fetch('when'), host, PATH)
        rule.fetch('actions').each do |action|
          key = action.fetch('reqHeader')
          if action.fetch('type') == 'unset'
            headers.delete(key)
          else
            headers[key] = properties.fetch(action.fetch('value').fetch('reqProperty'))
          end
        end
      end
      if HOSTS.include?(host)
        assert_equal [host, '203.0.113.7', 'US'], headers.values
      else
        assert_empty headers
      end
    end
  end

  def test_only_existing_profile_host_conditions_change
    yaml, status = Open3.capture2('git', 'show', "#{BASE}:config-eds/cdn.yaml", chdir: ROOT)
    assert status.success?
    original = YAML.safe_load(yaml)
    current = YAML.safe_load(File.read(File.join(ROOT, 'config-eds/cdn.yaml')))
    {
      'originSelectors' => 'route-suresmile-visitor-profile',
      'requestTransformations' => 'set-suresmile-profile-metadata',
      'responseTransformations' => 'no-store-suresmile-visitor-profile'
    }.each do |section, name|
      before = original.fetch('data').fetch(section).fetch('rules').find { |r| r['name'] == name }
      after = current.fetch('data').fetch(section).fetch('rules').find { |r| r['name'] == name }
      after['when'] = before.fetch('when')
    end
    assert_equal original, current
  end

  def test_independent_function_declaration_preserves_existing_functions_and_secrets
    yaml, status = Open3.capture2('git', 'show', "#{BASE}:config-eds/edgeFunctions.yaml", chdir: ROOT)
    assert status.success?
    current = YAML.safe_load(File.read(File.join(ROOT, 'config-eds/edgeFunctions.yaml')))
    functions = current.fetch('data').fetch('functions')
    assert_equal 1, functions.count { |function| function == { 'name' => 'suresmile-visitor-profile' } }
    assert_operator functions.length, :<=, 3
    assert_equal YAML.safe_load(yaml), current
  end

  def test_xsc_auth_and_geo_source_unchanged
    original, status = Open3.capture2('git', 'show', "#{BASE}:edge-functions-xsc-demo/src/index.js", chdir: ROOT)
    assert status.success?
    assert_equal original, File.read(File.join(ROOT, 'edge-functions-xsc-demo/src/index.js'))
    refute File.exist?(File.join(ROOT, 'edge-functions-xsc-demo/src/visitor-profile.js'))
  end

  def test_runtime_allowlist_matches_cdn_and_existing_managed_host_inventory
    hosts, status = Open3.capture2(
      'node', '--input-type=module', '-e',
      "import { PROFILE_HOSTS } from './edge-functions-suresmile/src/visitor-profile.js'; console.log(JSON.stringify([...PROFILE_HOSTS]));",
      chdir: ROOT
    )
    assert status.success?
    require 'json'
    assert_equal HOSTS.sort, JSON.parse(hosts).sort
    condition = DATA.fetch('originSelectors').fetch('rules').first.fetch('when')
    actual = condition.fetch('allOf').first.fetch('anyOf').map { |child| child.fetch('equals') }
    assert_equal HOSTS.sort, actual.sort
    yaml, status = Open3.capture2('git', 'show', "#{BASE}:config-eds/cdn.yaml", chdir: ROOT)
    assert status.success?
    inventory = YAML.safe_load(yaml).fetch('data').values.flat_map { |section| section.fetch('rules', []) }
    domains = []
    collect = lambda do |node|
      if node.is_a?(Hash) && node['reqProperty'] == 'domain' && node.key?('equals')
        domains << node.fetch('equals')
      end
      node.each_value { |child| collect.call(child) } if node.is_a?(Hash)
      node.each { |child| collect.call(child) } if node.is_a?(Array)
    end
    collect.call(inventory)
    assert_equal domains.uniq.sort, HOSTS.sort
  end
end
