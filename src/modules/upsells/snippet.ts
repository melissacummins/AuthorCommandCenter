// The storefront widget. This Liquid goes into the theme ONCE (Custom Liquid
// block on the product template); after that everything is managed from the
// Upsells module via the product metafield.
//
// Design constraints:
// - Unbreakable by product edits: the metafield stores only variant ids +
//   handles + labels; images, prices, and availability resolve live in
//   Liquid at render time.
// - Stats: the widget pings track_upsell_event (public counter RPC, anon
//   key) for views/clicks, and stamps a hidden line-item property on
//   add-ons so conversions come from real synced orders.
// - Discounts: when an offer has one, the widget shows the discount text +
//   struck-through prices and applies the offer's code before checkout.

// Public client-side values (same ones the app itself ships to browsers);
// RLS and the RPC's validation are what protect the data.
const SUPABASE_URL: string = import.meta.env.VITE_SUPABASE_URL || '';
const SUPABASE_ANON_KEY: string = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export function buildThemeSnippet(): string {
  const trackUrl = SUPABASE_URL ? `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/track_upsell_event` : '';

  return `{% comment %}
  Author Command Center — Add-ons widget (v2)
  Managed from the Upsells module. Reads product.metafields.author_cc.upsells.
  Paste once as a "Custom Liquid" block on the product template.
{% endcomment %}
{%- assign acc_offer = product.metafields.author_cc.upsells.value -%}
{%- if acc_offer.addons.size > 0 -%}
<div class="acc-addons" data-acc-addons
  data-acc-shop="{{ shop.permanent_domain }}"
  data-acc-product="{{ product.id }}"
  data-acc-code="{{ acc_offer.discount.code }}"
  data-acc-track="${trackUrl}"
  data-acc-key="${SUPABASE_ANON_KEY}">
  <p class="acc-addons__heading">{{ acc_offer.heading | default: 'Add to your order' }}</p>
  {%- if acc_offer.discount.text != blank -%}
  <p class="acc-addons__deal">{{ acc_offer.discount.text }}</p>
  {%- endif -%}
  {%- assign acc_keep = 100 -%}
  {%- if acc_offer.discount.pct -%}{%- assign acc_keep = 100 | minus: acc_offer.discount.pct -%}{%- endif -%}
  {%- for item in acc_offer.addons -%}
    {%- assign ap = all_products[item.handle] -%}
    {%- if ap and ap.available -%}
      {%- assign av = nil -%}
      {%- for v in ap.variants -%}
        {%- if v.id == item.variant_id -%}{%- assign av = v -%}{%- endif -%}
      {%- endfor -%}
      {%- unless av -%}{%- assign av = ap.selected_or_first_available_variant -%}{%- endunless -%}
      {%- if av and av.available -%}
      <label class="acc-addons__item">
        <input type="checkbox" class="acc-addons__check" value="{{ av.id }}">
        {%- assign aimg = av.featured_image | default: ap.featured_image -%}
        {%- if aimg -%}
        <img class="acc-addons__img" src="{{ aimg | image_url: width: 120 }}" alt="{{ ap.title | escape }}" loading="lazy" width="44" height="44">
        {%- endif -%}
        <span class="acc-addons__label">{% if item.label != blank %}{{ item.label }}{% else %}{{ ap.title }}{% endif %}</span>
        <span class="acc-addons__price">
          {%- if acc_keep < 100 -%}
          <s class="acc-addons__was">{{ av.price | money }}</s>
          + {{ av.price | times: acc_keep | divided_by: 100.0 | round | money }}
          {%- else -%}
          + {{ av.price | money }}
          {%- endif -%}
        </span>
      </label>
      {%- endif -%}
    {%- endif -%}
  {%- endfor -%}
</div>
<style>
  .acc-addons { margin: 16px 0; padding: 14px 16px; border: 1px solid rgba(0,0,0,.12); border-radius: 10px; }
  .acc-addons__heading { font-weight: 600; margin: 0 0 2px; }
  .acc-addons__deal { font-size: .85em; margin: 0 0 8px; opacity: .8; }
  .acc-addons__item { display: flex; align-items: center; gap: 10px; padding: 6px 0; cursor: pointer; }
  .acc-addons__check { flex: none; }
  .acc-addons__img { width: 44px; height: 44px; object-fit: cover; border-radius: 6px; flex: none; }
  .acc-addons__label { flex: 1; min-width: 0; }
  .acc-addons__price { font-weight: 600; white-space: nowrap; }
  .acc-addons__was { font-weight: 400; opacity: .55; margin-right: 4px; }
</style>
<script>
(function () {
  var box = document.querySelector('[data-acc-addons]:not([data-acc-bound])');
  if (!box) return;
  box.setAttribute('data-acc-bound', '1');

  var productId = box.getAttribute('data-acc-product');
  var code = box.getAttribute('data-acc-code');
  var clickSent = false;

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

  // One view per browser session per product; one click per pageview.
  try {
    if (!sessionStorage.getItem('accv' + productId)) {
      sessionStorage.setItem('accv' + productId, '1');
      track('view');
    }
  } catch (e) { track('view'); }
  box.addEventListener('change', function (e) {
    if (!clickSent && e.target && e.target.classList.contains('acc-addons__check')) {
      clickSent = true;
      track('click');
    }
  });

  // Find the product form: prefer an enclosing one, else the first
  // add-to-cart form on the page (Custom Liquid blocks sit outside the form).
  var form = box.closest('form[action*="/cart/add"]');
  if (!form) {
    var forms = document.querySelectorAll('form[action*="/cart/add"]');
    for (var i = 0; i < forms.length; i++) {
      if (forms[i].querySelector('[name="id"]')) { form = forms[i]; break; }
    }
  }
  if (!form) return;

  // On add-to-cart: add the checked add-ons via the cart API (stamped with
  // the attribution property), apply the offer's discount code if there is
  // one, then let the theme's own submit continue as normal. Capture phase
  // so this runs before AJAX-cart handlers.
  form.addEventListener('submit', function (e) {
    if (form.getAttribute('data-acc-done')) { form.removeAttribute('data-acc-done'); return; }
    var checked = box.querySelectorAll('.acc-addons__check:checked');
    if (!checked.length) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    var props = {};
    props['_acc_upsell'] = productId;
    var items = [];
    for (var i = 0; i < checked.length; i++) {
      items.push({ id: parseInt(checked[i].value, 10), quantity: 1, properties: props });
    }
    fetch('/cart/add.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: items })
    }).catch(function () {}).then(function () {
      if (code) { return fetch('/discount/' + encodeURIComponent(code)).catch(function () {}); }
    }).then(function () {
      form.setAttribute('data-acc-done', '1');
      if (form.requestSubmit) { form.requestSubmit(); } else { form.submit(); }
    });
  }, true);
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
    detail: 'Copy the code below into the Custom Liquid box and hit Save. That\'s it — the widget only appears on products that have an active offer, so nothing changes anywhere else.',
  },
];
