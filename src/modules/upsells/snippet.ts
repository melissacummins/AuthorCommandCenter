// The storefront widget. This Liquid goes into the theme ONCE (Custom Liquid
// block on the product template); after that everything is managed from the
// Upsells module via the product metafield.
//
// Design constraints:
// - Unbreakable by product edits: the metafield stores only variant ids +
//   handles + labels; images, prices, availability, and descriptions resolve
//   live in Liquid at render time.
// - SellEasy-style presentation: card per item with image/title/prices,
//   "+" separators, live total-price row, its own themed Add to cart button,
//   and a pop-up product preview on click.
// - Bundle-style offers (discount.trigger) show the main product as the
//   first (locked) card, pre-check the add-ons, and price the whole bundle
//   with the discount — matching frequently-bought-together semantics.
// - Stats: view/click counter pings + hidden line-item attribution property.

// Public client-side values (same ones the app itself ships to browsers);
// RLS and the RPC's validation are what protect the data.
const SUPABASE_URL: string = import.meta.env.VITE_SUPABASE_URL || '';
const SUPABASE_ANON_KEY: string = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export function buildThemeSnippet(): string {
  const trackUrl = SUPABASE_URL ? `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/track_upsell_event` : '';

  return `{% comment %}
  Author Command Center — Add-ons widget (v7)
  Managed from the Upsells module. Reads product.metafields.author_cc.upsells
  (the offer) and shop.metafields.author_cc.widget (design settings saved
  from the app's Design tab — changes there apply live, no re-paste needed).
  Paste once as a "Custom Liquid" block on the product template.
{% endcomment %}
{%- assign acc_offer = product.metafields.author_cc.upsells.value -%}
{%- if acc_offer.addons.size > 0 -%}
{%- assign acc_cfg = shop.metafields.author_cc.widget.value -%}
{%- assign acc_popup = true -%}{%- if acc_cfg.popup == false -%}{%- assign acc_popup = false -%}{%- endif -%}
{%- assign acc_plus = true -%}{%- if acc_cfg.show_plus == false -%}{%- assign acc_plus = false -%}{%- endif -%}
{%- assign acc_pct = acc_offer.discount.pct | default: 0 -%}
{%- assign acc_keep = 100 | minus: acc_pct -%}
{%- assign acc_tv = product.selected_or_first_available_variant -%}
{%- assign acc_tprice = acc_tv.price -%}
{%- assign acc_tcompare = acc_tv.compare_at_price | default: acc_tv.price -%}
{%- if acc_offer.discount.trigger and acc_pct > 0 -%}
  {%- assign acc_teff = acc_tprice | times: acc_keep | divided_by: 100.0 | round -%}
{%- else -%}
  {%- assign acc_teff = acc_tprice -%}
{%- endif -%}
<div class="acc-addons" data-acc-addons
  style="--acc-radius: {{ acc_cfg.radius | default: 12 }}px;{% if acc_cfg.button_bg != blank %} --acc-btn-bg: {{ acc_cfg.button_bg }};{% endif %}{% if acc_cfg.button_text != blank %} --acc-btn-text: {{ acc_cfg.button_text }};{% endif %}"
  data-acc-shop="{{ shop.permanent_domain }}"
  data-acc-product="{{ product.id }}"
  data-acc-code="{{ acc_offer.discount.code }}"
  data-acc-track="${trackUrl}"
  data-acc-key="${SUPABASE_ANON_KEY}"
  data-acc-money="{{ shop.money_format | strip_html | escape }}"
  data-acc-cur="{{ cart.currency.iso_code }}"
  data-acc-locale="{{ request.locale.iso_code }}"
  data-acc-tvid="{{ acc_tv.id }}"
  data-acc-tprice="{{ acc_teff }}"
  data-acc-twas="{{ acc_tcompare }}">
  <h3 class="acc-addons__heading">{{ acc_offer.heading | default: 'Add to your order' }}</h3>
  {%- if acc_offer.discount.text != blank -%}
  <p class="acc-addons__deal">{{ acc_offer.discount.text }}</p>
  {%- endif -%}

  {%- assign acc_shown = 0 -%}
  {%- if acc_offer.discount.trigger -%}
  {%- assign acc_shown = 1 -%}
  <div class="acc-addons__card acc-addons__card--self">
    <input type="checkbox" class="acc-addons__check" checked disabled>
    {%- if product.featured_image -%}
    <img class="acc-addons__img" src="{{ product.featured_image | image_url: width: 200 }}" alt="{{ product.title | escape }}" loading="lazy" width="64" height="64">
    {%- endif -%}
    <div class="acc-addons__info">
      <span class="acc-addons__title">{{ product.title }}</span>
      <span class="acc-addons__prices">
        {%- if acc_teff < acc_tcompare -%}<s>{{ acc_tcompare | money }}</s> {% endif %}<strong>{{ acc_teff | money }}</strong>
      </span>
    </div>
  </div>
  {%- endif -%}

  {%- for item in acc_offer.addons -%}
    {%- assign ap = all_products[item.handle] -%}
    {%- if ap and ap.available -%}
      {%- assign av = nil -%}
      {%- for v in ap.variants -%}
        {%- if v.id == item.variant_id -%}{%- assign av = v -%}{%- endif -%}
      {%- endfor -%}
      {%- unless av -%}{%- assign av = ap.selected_or_first_available_variant -%}{%- endunless -%}
      {%- if av and av.available -%}
      {%- if acc_pct > 0 -%}
        {%- assign acc_dprice = av.price | times: acc_keep | divided_by: 100.0 | round -%}
      {%- else -%}
        {%- assign acc_dprice = av.price -%}
      {%- endif -%}
      {%- assign acc_awas = av.compare_at_price | default: av.price -%}
      {%- if acc_shown > 0 and acc_plus -%}
      <div class="acc-addons__plus" aria-hidden="true">+</div>
      {%- endif -%}
      {%- assign acc_shown = acc_shown | plus: 1 -%}
      <div class="acc-addons__card" data-acc-item
        data-acc-vid="{{ av.id }}"
        data-acc-price="{{ acc_dprice }}"
        data-acc-was="{{ acc_awas }}">
        <input type="checkbox" class="acc-addons__check" value="{{ av.id }}"{% if acc_offer.discount.trigger %} checked{% endif %} aria-label="Add {{ ap.title | escape }}">
        {%- assign aimg = av.featured_image | default: ap.featured_image -%}
        {%- if aimg -%}
        <img class="acc-addons__img" src="{{ aimg | image_url: width: 200 }}" alt="{{ ap.title | escape }}" loading="lazy" width="64" height="64"{% if acc_popup %} data-acc-pop="{{ forloop.index }}"{% endif %}>
        {%- endif -%}
        <div class="acc-addons__info">
          <button type="button" class="acc-addons__title acc-addons__title--link"{% if acc_popup %} data-acc-pop="{{ forloop.index }}"{% endif %}>
            {%- if item.label != blank -%}{{ item.label }}{%- else -%}{{ ap.title }}{%- endif -%}
          </button>
          <span class="acc-addons__prices">
            {%- if acc_dprice < av.price -%}<s>{{ av.price | money }}</s> <strong>{{ acc_dprice | money }}</strong>
            {%- elsif acc_awas > av.price -%}<s>{{ acc_awas | money }}</s> <strong>{{ av.price | money }}</strong>
            {%- else -%}<strong>{{ av.price | money }}</strong>{%- endif -%}
          </span>
        </div>
      </div>
      {%- if acc_popup -%}
      <div class="acc-modal" data-acc-modal="{{ forloop.index }}" hidden>
        <div class="acc-modal__backdrop" data-acc-close></div>
        <div class="acc-modal__box" role="dialog" aria-modal="true" aria-label="{{ ap.title | escape }}">
          <button type="button" class="acc-modal__close" data-acc-close aria-label="Close">&times;</button>
          {%- if aimg -%}
          {%- assign acc_gstart = 0 -%}
          {%- for gim in ap.images -%}{%- if gim.id == aimg.id -%}{%- assign acc_gstart = forloop.index0 -%}{%- endif -%}{%- endfor -%}
          <div class="acc-modal__gallery" data-acc-gallery data-acc-gstart="{{ acc_gstart }}"
            data-acc-gsrcs="{% for gim in ap.images %}{{ gim | image_url: width: 600 }}{% unless forloop.last %}|{% endunless %}{% endfor %}">
            <img class="acc-modal__img" src="{{ aimg | image_url: width: 600 }}" alt="{{ ap.title | escape }}" loading="lazy" data-acc-gimg>
            {%- if ap.images.size > 1 -%}
            <button type="button" class="acc-modal__gbtn acc-modal__gbtn--prev" data-acc-gprev aria-label="Previous image">&#8249;</button>
            <button type="button" class="acc-modal__gbtn acc-modal__gbtn--next" data-acc-gnext aria-label="Next image">&#8250;</button>
            <span class="acc-modal__gcount" data-acc-gcount>{{ acc_gstart | plus: 1 }}/{{ ap.images.size }}</span>
            {%- endif -%}
          </div>
          {%- endif -%}
          <h4 class="acc-modal__title">{{ ap.title }}</h4>
          <p class="acc-modal__price">
            {%- if acc_dprice < av.price -%}<s>{{ av.price | money }}</s> <strong>{{ acc_dprice | money }}</strong>
            {%- elsif acc_awas > av.price -%}<s>{{ acc_awas | money }}</s> <strong>{{ av.price | money }}</strong>
            {%- else -%}<strong>{{ av.price | money }}</strong>{%- endif -%}
          </p>
          <div class="acc-modal__desc">{{ ap.description }}</div>
        </div>
      </div>
      {%- endif -%}
      {%- endif -%}
    {%- endif -%}
  {%- endfor -%}

  <div class="acc-addons__total">
    <span>{{ acc_cfg.total_label | default: 'Total price' }}</span>
    <strong data-acc-total></strong>
    <s data-acc-total-was hidden></s>
  </div>
  <button type="button" class="acc-addons__atc" data-acc-atc>{{ acc_cfg.button_label | default: 'Add to cart' }}</button>
</div>
<style>
  .acc-addons { margin: 20px 0; }
  .acc-addons__heading { margin: 0 0 2px; font-size: 1.15em; }
  .acc-addons__deal { margin: 0 0 14px; opacity: .75; }
  .acc-addons__card { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border: 1px solid rgba(0,0,0,.14); border-radius: var(--acc-radius, 12px); }
  .acc-addons__check { flex: none; width: 18px; height: 18px; }
  .acc-addons__img { width: 64px; height: 64px; object-fit: contain; border-radius: 8px; flex: none; cursor: pointer; }
  .acc-addons__card--self .acc-addons__img { cursor: default; }
  .acc-addons__info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
  .acc-addons__title { font-weight: 500; text-align: left; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .acc-addons__title--link { background: none; border: 0; padding: 0; margin: 0; font: inherit; color: inherit; cursor: pointer; }
  .acc-addons__title--link:hover { text-decoration: underline; }
  .acc-addons__prices s { opacity: .55; margin-right: 6px; }
  .acc-addons__plus { text-align: center; padding: 0; line-height: 1.1; opacity: .6; }
  .acc-addons__total { display: flex; align-items: baseline; gap: 10px; margin: 12px 0 8px; font-size: 1.1em; }
  .acc-addons__total s { opacity: .55; }
  .acc-addons__atc { width: 100%; padding: 14px 20px; border: 0; border-radius: var(--acc-radius, 12px); font-size: 1em; cursor: pointer;
    font-family: inherit; letter-spacing: inherit;
    background: var(--acc-btn-bg, rgb(var(--color-button, 65 65 65))); color: var(--acc-btn-text, rgb(var(--color-button-text, 255 255 255))); }
  .acc-addons__atc:hover { opacity: .9; }
  .acc-addons__atc[disabled] { opacity: .6; cursor: wait; }
  /* Dim + blur live on the container, not just the backdrop child — a
     plain dark overlay is nearly invisible on dark themes. */
  .acc-modal { position: fixed; inset: 0; z-index: 999; display: flex; align-items: center; justify-content: center;
    background: rgba(0,0,0,.65); -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px); }
  /* The display:flex above would otherwise defeat the hidden attribute,
     leaving an invisible full-screen layer that swallows every click. */
  .acc-modal[hidden] { display: none !important; }
  .acc-modal__backdrop { position: absolute; inset: 0; }
  .acc-modal__box { position: relative; background: #fff; color: #222; border-radius: 14px; max-width: 480px; width: calc(100% - 32px);
    max-height: 84vh; overflow-y: auto; padding: 28px 24px 24px; }
  .acc-modal__close { position: absolute; top: 8px; right: 12px; background: none; border: 0; font-size: 28px; line-height: 1; cursor: pointer; color: #444; }
  .acc-modal__gallery { position: relative; }
  .acc-modal__img { display: block; max-width: 280px; width: 100%; margin: 0 auto 14px; }
  .acc-modal__gbtn { position: absolute; top: 50%; transform: translateY(-50%); width: 36px; height: 36px; border-radius: 50%;
    border: 1px solid rgba(0,0,0,.15); background: rgba(255,255,255,.92); color: #222; font-size: 22px; line-height: 1; cursor: pointer; }
  .acc-modal__gbtn--prev { left: 2px; }
  .acc-modal__gbtn--next { right: 2px; }
  .acc-modal__gcount { position: absolute; bottom: 20px; right: 8px; background: rgba(0,0,0,.55); color: #fff; font-size: 12px; padding: 2px 8px; border-radius: 10px; }
  .acc-modal__title { margin: 0 0 6px; font-size: 1.15em; }
  .acc-modal__price { margin: 0 0 12px; }
  .acc-modal__price s { opacity: .55; margin-right: 6px; }
  .acc-modal__desc { font-size: .92em; line-height: 1.55; }
  .acc-modal__desc img { max-width: 100%; height: auto; }
</style>
<script>
(function () {
  var box = document.querySelector('[data-acc-addons]:not([data-acc-bound])');
  if (!box) return;
  box.setAttribute('data-acc-bound', '1');

  var productId = box.getAttribute('data-acc-product');
  var code = box.getAttribute('data-acc-code');
  var moneyFormat = box.getAttribute('data-acc-money') || '$' + '{{amount}}';
  // Prices in Liquid render in the shopper's active (market) currency, but
  // shop.money_format is the store's BASE currency — formatting the JS
  // total with it showed EGP to a shopper browsing in USD. Format with the
  // active cart currency instead; the old format string is the fallback.
  var currency = box.getAttribute('data-acc-cur') || '';
  var locale = box.getAttribute('data-acc-locale') || undefined;
  var clickSent = false;

  function fmtMoney(cents) {
    if (currency) {
      try {
        return new Intl.NumberFormat(locale, { style: 'currency', currency: currency }).format(cents / 100);
      } catch (e) { /* fall through to money_format */ }
    }
    var noDecimals = moneyFormat.indexOf('no_decimals') !== -1;
    var comma = moneyFormat.indexOf('comma_separator') !== -1;
    var n = noDecimals ? Math.round(cents / 100).toString() : (cents / 100).toFixed(2);
    var parts = n.split('.');
    parts[0] = parts[0].replace(/\\B(?=(\\d{3})+(?!\\d))/g, comma ? '.' : ',');
    var out = comma ? parts.join(',') : parts.join('.');
    return moneyFormat.replace(/\\{\\{\\s*amount[^}]*\\}\\}/, out);
  }

  function track(event) {
    var url = box.getAttribute('data-acc-track');
    var key = box.getAttribute('data-acc-key');
    if (!url || !key) return;
    try {
      fetch(url, {
        method: 'POST',
        headers: { 'apikey': key, 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_shop: box.getAttribute('data-acc-shop'), p_product_id: productId, p_event: event }),
        keepalive: true
      }).catch(function () {});
    } catch (e) {}
  }

  try {
    if (!sessionStorage.getItem('accv' + productId)) {
      sessionStorage.setItem('accv' + productId, '1');
      track('view');
    }
  } catch (e) { track('view'); }

  function items() {
    return Array.prototype.slice.call(box.querySelectorAll('[data-acc-item]'));
  }
  function checkedItems() {
    return items().filter(function (el) { return el.querySelector('.acc-addons__check').checked; });
  }

  // ---- Live total ----
  var totalEl = box.querySelector('[data-acc-total]');
  var wasEl = box.querySelector('[data-acc-total-was]');
  function recalc() {
    var total = parseInt(box.getAttribute('data-acc-tprice'), 10) || 0;
    var was = parseInt(box.getAttribute('data-acc-twas'), 10) || 0;
    checkedItems().forEach(function (el) {
      total += parseInt(el.getAttribute('data-acc-price'), 10) || 0;
      was += parseInt(el.getAttribute('data-acc-was'), 10) || 0;
    });
    if (totalEl) totalEl.textContent = fmtMoney(total);
    if (wasEl) {
      if (was > total) { wasEl.textContent = fmtMoney(was); wasEl.hidden = false; }
      else { wasEl.hidden = true; }
    }
  }
  recalc();

  box.addEventListener('change', function (e) {
    if (e.target && e.target.classList.contains('acc-addons__check')) {
      if (!clickSent) { clickSent = true; track('click'); }
      recalc();
    }
  });

  // ---- Pop-up product preview ----
  // Theme sections often carry CSS transforms (scroll animations), and
  // position:fixed inside a transformed ancestor pins to that ancestor,
  // not the screen — the modal would land in-flow near the description.
  // Moving the modals to <body> restores true centered-on-screen behavior.
  Array.prototype.slice.call(document.body.children).forEach(function (el) {
    if (el.classList && el.classList.contains('acc-modal')) el.parentNode.removeChild(el);
  });
  var modals = {};
  Array.prototype.slice.call(box.querySelectorAll('.acc-modal')).forEach(function (m) {
    modals[m.getAttribute('data-acc-modal')] = m;
    document.body.appendChild(m);
  });
  var lastOpener = null;
  function openedModal() {
    var open = null;
    Object.keys(modals).forEach(function (k) { if (!modals[k].hidden) open = modals[k]; });
    return open;
  }
  function openModal(key, opener) {
    var m = modals[key];
    if (!m) return;
    lastOpener = opener || null;
    m.hidden = false;
    document.body.style.overflow = 'hidden';
    var closeBtn = m.querySelector('.acc-modal__close');
    if (closeBtn) closeBtn.focus();
  }
  function closeModals() {
    if (!openedModal()) return;
    Object.keys(modals).forEach(function (k) { modals[k].hidden = true; });
    document.body.style.overflow = '';
    if (lastOpener && lastOpener.focus) lastOpener.focus();
    lastOpener = null;
  }
  function cycleGallery(gal, dir) {
    if (!gal) return;
    var srcs = (gal.getAttribute('data-acc-gsrcs') || '').split('|').filter(Boolean);
    if (srcs.length < 2) return;
    var i = parseInt(gal.getAttribute('data-acc-gi') || gal.getAttribute('data-acc-gstart') || '0', 10);
    i = (i + dir + srcs.length) % srcs.length;
    gal.setAttribute('data-acc-gi', String(i));
    var img = gal.querySelector('[data-acc-gimg]');
    if (img) img.src = srcs[i];
    var count = gal.querySelector('[data-acc-gcount]');
    if (count) count.textContent = (i + 1) + '/' + srcs.length;
  }
  document.addEventListener('click', function (e) {
    if (!e.target.closest) return;
    var opener = e.target.closest('[data-acc-pop]');
    if (opener && box.contains(opener)) { openModal(opener.getAttribute('data-acc-pop'), opener); return; }
    var nav = e.target.closest('[data-acc-gprev], [data-acc-gnext]');
    if (nav) { cycleGallery(nav.closest('[data-acc-gallery]'), nav.hasAttribute('data-acc-gnext') ? 1 : -1); return; }
    var closer = e.target.closest('[data-acc-close]');
    if (closer) closeModals();
  });
  document.addEventListener('keydown', function (e) {
    var open = openedModal();
    if (!open) return;
    if (e.key === 'Escape') { closeModals(); }
    else if (e.key === 'ArrowRight') { cycleGallery(open.querySelector('[data-acc-gallery]'), 1); }
    else if (e.key === 'ArrowLeft') { cycleGallery(open.querySelector('[data-acc-gallery]'), -1); }
  });

  // The real buy-buttons form. Themes also render a hidden payment-terms
  // form posting to /cart/add with its own [name="id"] — matching that one
  // would break both variant detection and the submit interception below.
  var form = box.closest('form[action*="/cart/add"]');
  if (!form) {
    var candidates = document.querySelectorAll('form[action*="/cart/add"]');
    for (var i = 0; i < candidates.length; i++) {
      if (candidates[i].querySelector('button[name="add"], button[type="submit"], input[type="submit"]')) { form = candidates[i]; break; }
    }
    if (!form) {
      for (var j = 0; j < candidates.length; j++) {
        if (candidates[j].querySelector('[name="id"]')) { form = candidates[j]; break; }
      }
    }
  }

  function triggerVariantId() {
    var input = form && form.querySelector('[name="id"]');
    return parseInt((input && input.value) || box.getAttribute('data-acc-tvid'), 10);
  }
  function addonLines() {
    return checkedItems().map(function (el) {
      return {
        id: parseInt(el.getAttribute('data-acc-vid'), 10),
        quantity: 1,
        properties: { _acc_upsell: productId }
      };
    });
  }
  function applyCodeIfNeeded(hasAddons) {
    if (code && hasAddons) { return fetch('/discount/' + encodeURIComponent(code)).catch(function () {}); }
    return Promise.resolve();
  }

  // ---- Widget Add to cart: main product + checked add-ons, then cart ----
  var atc = box.querySelector('[data-acc-atc]');
  if (atc) {
    atc.addEventListener('click', function () {
      atc.disabled = true;
      var lines = [{ id: triggerVariantId(), quantity: 1 }].concat(addonLines());
      fetch('/cart/add.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: lines })
      }).catch(function () {}).then(function () {
        return applyCodeIfNeeded(lines.length > 1);
      }).then(function () {
        window.location.href = '/cart';
      });
    });
  }

  // ---- Theme Add to cart still works: sneak checked add-ons in first ----
  if (form) {
    form.addEventListener('submit', function (e) {
      if (form.getAttribute('data-acc-done')) { form.removeAttribute('data-acc-done'); return; }
      var lines = addonLines();
      if (!lines.length) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      fetch('/cart/add.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: lines })
      }).catch(function () {}).then(function () {
        return applyCodeIfNeeded(true);
      }).then(function () {
        form.setAttribute('data-acc-done', '1');
        if (form.requestSubmit) { form.requestSubmit(); } else { form.submit(); }
      });
    }, true);
  }
})();
</script>
{%- endif -%}
`;
}

export const INSTALL_STEPS: { title: string; detail: string }[] = [
  {
    title: 'Open the theme editor',
    detail: 'In Shopify admin go to Online Store → Themes → Customize (on your live theme).',
  },
  {
    title: 'Go to the product template',
    detail: 'Use the page selector at the top and choose Products → Default product.',
  },
  {
    title: 'Add a Custom Liquid block',
    detail: 'In the left panel, inside the "Product information" section, click "Add block" → "Custom Liquid". Drag it where you want the add-ons to appear (right above the Buy buttons works well).',
  },
  {
    title: 'Paste the snippet and save',
    detail: 'Copy the code below into the Custom Liquid box and hit Save. That\'s it — the widget only appears on products that have an active offer, so nothing changes anywhere else. When the snippet is updated here, re-paste it over the old block.',
  },
];
