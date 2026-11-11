require 'minitest/autorun'
require 'yaml'
require 'uri'

class SureSmileProxyTest < Minitest::Test
  ROOT = File.expand_path('../..', __dir__)
  CONFIG = YAML.safe_load(File.read(File.join(ROOT, 'config-eds/cdn.yaml')))
  SELECTORS = CONFIG.fetch('data').fetch('originSelectors')
  RULE = SELECTORS.fetch('rules').find { |rule| rule['name'] == 'route-suresmile-doctors' }
  ORIGIN = SELECTORS.fetch('origins').find { |origin| origin['name'] == 'suresmile-api' }

  def matches?(condition, request)
    if condition.key?('allOf')
      condition.fetch('allOf').all? { |child| matches?(child, request) }
    elsif condition.key?('anyOf')
      condition.fetch('anyOf').any? { |child| matches?(child, request) }
    else
      value = request.fetch(condition.fetch('reqProperty'))
      if condition.key?('equals')
        value == condition.fetch('equals')
      elsif condition.key?('matches')
        Regexp.new(condition.fetch('matches')).match?(value)
      else
        !Regexp.new(condition.fetch('doesNotMatch')).match?(value)
      end
    end
  end

  def request(url, method = 'GET')
    uri = URI(url)
    {
      'domain' => uri.host.downcase,
      'originalPath' => uri.path,
      'path' => uri.path,
      'method' => method
    }
  end

  def test_exact_get_route_preserves_search_and_pagination
    queries = [
      'lat=37.7813454&lng=-122.497668&radius=10&page=1&per_page=20&unit=mi',
      'lat=40.7128&lng=-74.0060&radius=25&page=2&per_page=5&unit=km',
      'search=San%20Francisco&language=en&specialty=orthodontist',
      ''
    ]
    queries.each do |query|
      url = "https://suresmile.ynaka-adobe.com/api/location/doctors?#{query}"
      assert matches?(RULE.fetch('when'), request(url)), url
      CONFIG.fetch('data').fetch('requestTransformations').fetch('rules').each do |rule|
        next if rule.fetch('actions').all? { |action| action.key?('reqHeader') }
        refute matches?(rule.fetch('when'), request(url)), rule.fetch('name')
      end
    end
    assert_equal(
      { 'type' => 'selectOrigin', 'originName' => 'suresmile-api', 'skipCache' => true },
      RULE.fetch('action')
    )
    assert_equal(
      [
        { 'reqProperty' => 'domain', 'equals' => 'suresmile.ynaka-adobe.com' },
        { 'reqProperty' => 'originalPath', 'equals' => '/api/location/doctors' },
        { 'reqProperty' => 'method', 'equals' => 'GET' }
      ],
      RULE.fetch('when').fetch('allOf')
    )
  end

  def test_other_hosts_paths_and_methods_do_not_proxy
    %w[
      https://dupont.ynaka-adobe.com/api/location/doctors
      https://3m.ynaka-adobe.com/api/location/doctors
      https://suresmile.ynaka-adobe.com.evil.example/api/location/doctors
      https://main--suresmile--ynaka-adobe.aem.live/api/location/doctors
      https://suresmile.ynaka-adobe.com/en-us
      https://suresmile.ynaka-adobe.com/api/location/doctors/
      https://suresmile.ynaka-adobe.com/api/location/doctors/123
      https://suresmile.ynaka-adobe.com/api/location/other
    ].each do |url|
      refute matches?(RULE.fetch('when'), request(url)), url
    end
    %w[POST PUT DELETE PATCH OPTIONS HEAD].each do |method|
      refute matches?(
        RULE.fetch('when'),
        request('https://suresmile.ynaka-adobe.com/api/location/doctors', method)
      ), method
    end
  end

  def test_fixed_origin_does_not_forward_visitor_credentials
    assert_equal(
      {
        'name' => 'suresmile-api',
        'domain' => 'www.suresmile.com',
        'forwardHost' => false,
        'forwardCookie' => false,
        'forwardAuthorization' => false
      },
      ORIGIN
    )
  end

  def test_unique_names_and_configuration_size
    %w[rules origins].each do |key|
      names = SELECTORS.fetch(key).map { |entry| entry.fetch('name') }
      assert_equal names.uniq, names
    end
    assert_operator File.size(File.join(ROOT, 'config-eds/cdn.yaml')), :<, 100_000
  end
end
