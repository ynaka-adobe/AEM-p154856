require 'minitest/autorun'
require 'yaml'
require 'open3'

class VisitorProfileCdnTest < Minitest::Test
  ROOT = File.expand_path('../..', __dir__)
  CONFIG = YAML.safe_load(File.read(File.join(ROOT, 'config-eds/cdn.yaml')))
  DATA = CONFIG.fetch('data')
  HOST = 'suresmile.ynaka-adobe.com'
  PATH = '/api/visitor-profile'

  def matches?(condition, host, path)
    return true if condition == '*'
    condition.fetch('allOf').all? do |child|
      { 'domain' => host, 'originalPath' => path }.fetch(child.fetch('reqProperty')) == child.fetch('equals')
    end
  end

  def test_exact_route_and_cache_policy_for_all_methods
    route = DATA.fetch('originSelectors').fetch('rules').find { |r| r['name'] == 'route-suresmile-visitor-profile' }
    assert_equal(
      { 'type' => 'selectAemOrigin', 'originName' => 'edgefunction-suresmile-visitor-profile', 'skipCache' => true },
      route.fetch('action')
    )
    assert matches?(route.fetch('when'), HOST, PATH)
    [HOST + '.evil.example', 'xsc-demo.ynaka-adobe.com', 'main--suresmile--ynaka-adobe.aem.live'].each do |host|
      refute matches?(route.fetch('when'), host, PATH)
    end
    ['/en-us', PATH + '/', '/api/location/doctors'].each do |path|
      refute matches?(route.fetch('when'), HOST, path)
    end
    cache = DATA.fetch('responseTransformations').fetch('rules').find { |r| r['name'] == 'no-store-suresmile-visitor-profile' }
    assert_equal route.fetch('when'), cache.fetch('when')
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
    [HOST, 'xsc-demo.ynaka-adobe.com'].each do |host|
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
      if host == HOST
        assert_equal [HOST, '203.0.113.7', 'US'], headers.values
      else
        assert_empty headers
      end
    end
  end

  def test_existing_configuration_unchanged_after_removing_new_rules
    yaml, status = Open3.capture2('git', 'show', 'b23c4e9:config-eds/cdn.yaml', chdir: ROOT)
    assert status.success?
    current = YAML.safe_load(File.read(File.join(ROOT, 'config-eds/cdn.yaml')))
    data = current.fetch('data')
    data.fetch('originSelectors').fetch('rules').reject! { |r| r['name'] == 'route-suresmile-visitor-profile' }
    data.fetch('requestTransformations').fetch('rules').reject! do |r|
      ['strip-suresmile-profile-metadata', 'set-suresmile-profile-metadata'].include?(r['name'])
    end
    data.delete('responseTransformations')
    assert_equal YAML.safe_load(yaml), current
  end

  def test_independent_function_declaration_preserves_existing_functions_and_secrets
    yaml, status = Open3.capture2('git', 'show', '252287f:config-eds/edgeFunctions.yaml', chdir: ROOT)
    assert status.success?
    current = YAML.safe_load(File.read(File.join(ROOT, 'config-eds/edgeFunctions.yaml')))
    functions = current.fetch('data').fetch('functions')
    assert_equal 1, functions.count { |function| function == { 'name' => 'suresmile-visitor-profile' } }
    assert_operator functions.length, :<=, 3
    functions.reject! { |function| function['name'] == 'suresmile-visitor-profile' }
    assert_equal YAML.safe_load(yaml), current
  end

  def test_xsc_source_is_restored_without_profile_branch
    original, status = Open3.capture2('git', 'show', 'b23c4e9:edge-functions-xsc-demo/src/index.js', chdir: ROOT)
    assert status.success?
    assert_equal original, File.read(File.join(ROOT, 'edge-functions-xsc-demo/src/index.js'))
    refute File.exist?(File.join(ROOT, 'edge-functions-xsc-demo/src/visitor-profile.js'))
  end
end
