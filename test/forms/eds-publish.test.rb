require 'minitest/autorun'
require 'json'
require 'uri'

class EdsPublishTest < Minitest::Test
  ROOT = File.expand_path('../..', __dir__)
  PUBLISH = File.join(
    ROOT, 'ui.config/src/main/content/jcr_root/apps/demosandbox/osgiconfig/config.publish'
  )
  CORS = JSON.parse(File.read(File.join(
    PUBLISH, 'com.adobe.granite.cors.impl.CORSPolicyImpl~forms-eds.cfg.json'
  )))
  REFERRER = JSON.parse(File.read(File.join(
    PUBLISH, 'org.apache.sling.security.impl.ReferrerFilter.cfg.json'
  )))

  def regex_matches?(patterns, value)
    patterns.any? { |pattern| Regexp.new("\\A(?:#{pattern})\\z").match?(value) }
  end

  def cors_allows?(origin)
    CORS.fetch('alloworigin').include?(origin) ||
      regex_matches?(CORS.fetch('alloworiginregexp'), origin)
  end

  def referrer_allows?(referrer)
    uri = URI(referrer)
    REFERRER.fetch('allow.hosts').include?(uri.host) ||
      regex_matches?(
        REFERRER.fetch('allow.hosts.regexp'), "#{uri.scheme}://#{uri.host}:#{uri.port}"
      )
  end

  def test_both_sites_custom_domains_and_https_branches
    %w[toyotafinancial hitachienergy].each do |site|
      origins = ["https://#{site}.ynaka-adobe.com"]
      %w[main feature-order].product(%w[page live]).each do |branch, tier|
        origins << "https://#{branch}--#{site}--ynaka-adobe.aem.#{tier}"
      end
      origins.each do |origin|
        assert cors_allows?(origin), origin
        assert referrer_allows?("#{origin}/forms/order?source=demo"), origin
      end
    end
  end

  def test_branch_regexes_reject_other_sites_schemes_ports_and_suffixes
    %w[toyotafinancial hitachienergy].each do |site|
      [
        "http://main--#{site}--ynaka-adobe.aem.live",
        "https://main--#{site}--ynaka-adobe.aem.live:8443",
        "https://main--#{site}--ynaka-adobe.aem.live.evil.example",
        "https://main--#{site}--someone-else.aem.live"
      ].each do |origin|
        refute cors_allows?(origin), origin
        refute referrer_allows?("#{origin}/forms/order"), origin
      end
    end
    refute cors_allows?('https://unrelated.ynaka-adobe.com')
    refute referrer_allows?('https://unrelated.ynaka-adobe.com/forms/order')
  end

  def test_singleton_preserves_existing_okta_and_referrer_protection
    configs = Dir.glob(File.join(PUBLISH, 'org.apache.sling.security.impl.ReferrerFilter*.cfg.json'))
    assert_equal ['org.apache.sling.security.impl.ReferrerFilter.cfg.json'], configs.map { |p| File.basename(p) }
    assert referrer_allows?('https://trial-5076725.okta.com/app/saml')
    assert referrer_allows?('http://localhost:4503/forms/order')
    assert_equal false, REFERRER.fetch('allow.empty')
    assert_equal %w[POST PUT DELETE COPY MOVE], REFERRER.fetch('filter.methods')
  end

  def test_forms_preflight_headers_reach_publish_and_policy_is_scoped
    headers = File.read(File.join(
      ROOT, 'dispatcher/src/conf.dispatcher.d/clientheaders/clientheaders.any'
    ))
    %w[Origin Access-Control-Request-Method Access-Control-Request-Headers x-adobe-form-hostname].each do |header|
      assert_includes headers, "\"#{header}\""
    end
    assert_includes headers, '$include "./default_clientheaders.any"'
    assert_includes CORS.fetch('supportedmethods'), 'POST'
    assert_includes CORS.fetch('supportedmethods'), 'OPTIONS'
    %w[Content-Type x-adobe-form-hostname].each do |header|
      assert_includes CORS.fetch('supportedheaders'), header
    end
    assert_equal false, CORS.fetch('supportscredentials')
    assert regex_matches?(CORS.fetch('allowedpaths'), '/adobe/forms/af/submit/encoded-path')
    assert regex_matches?(CORS.fetch('allowedpaths'), '/content/forms/af/order.model.json')
    refute regex_matches?(CORS.fetch('allowedpaths'), '/content/unrelated/page')
  end
end
