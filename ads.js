// Google AdSense loader, gated behind a simple accept/decline cookie-consent banner.
// TODO: replace this with your real AdSense publisher ID once your account is approved
// (https://www.google.com/adsense/) — it looks like "ca-pub-1234567890123456".
const ADSENSE_CLIENT = 'ca-pub-0000000000000000';
const CONSENT_KEY = 'ads-consent';

function readConsent() {
  try {
    return localStorage.getItem(CONSENT_KEY);
  } catch {
    return null;
  }
}

function writeConsent(value) {
  try {
    localStorage.setItem(CONSENT_KEY, value);
  } catch {
    // Private browsing or storage disabled — consent just won't be remembered next visit.
  }
}

function loadAdsenseScript() {
  const script = document.createElement('script');
  script.async = true;
  script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}`;
  script.crossOrigin = 'anonymous';
  script.onload = () => {
    document.querySelectorAll('ins.adsbygoogle').forEach(() => {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    });
  };
  document.head.appendChild(script);
}

function showConsentBanner() {
  const banner = document.createElement('div');
  banner.id = 'ads-consent-banner';
  banner.innerHTML = `
    <p>This site shows ads to help keep the game free. Ads use cookies to personalize content. <a href="privacy-policy.html">Learn more</a>.</p>
    <div class="ads-consent-buttons">
      <button type="button" id="ads-consent-accept" class="menu-button">Accept</button>
      <button type="button" id="ads-consent-decline" class="menu-button menu-button-secondary">Decline</button>
    </div>
  `;
  document.body.appendChild(banner);

  banner.querySelector('#ads-consent-accept').addEventListener('click', () => {
    writeConsent('accepted');
    banner.remove();
    loadAdsenseScript();
  });
  banner.querySelector('#ads-consent-decline').addEventListener('click', () => {
    writeConsent('declined');
    banner.remove();
  });
}

const consent = readConsent();
if (consent === 'accepted') {
  loadAdsenseScript();
} else if (consent !== 'declined') {
  showConsentBanner();
}
