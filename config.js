/**
 * ShiftMate UK — site config.
 * Flip UNLOCK_ENABLED to true when you are ready to gate features.
 * Payments are a Stripe Payment Link (no backend; GitHub Pages friendly).
 */
(function (global) {
  'use strict';

  global.ShiftMateConfig = {
    /** When false, nothing is gated and the Unlock tab is hidden. */
    UNLOCK_ENABLED: false,

    UNLOCK_PRICE: '£4.99',
    UNLOCK_PRICE_LABEL: 'one-off',

    /**
     * Stripe Payment Link URL, e.g. 'https://buy.stripe.com/xxxx'.
     * In the Stripe dashboard set the after-payment success URL to this
     * app with ?unlocked=YOUR_CODE (example:
     * https://<user>.github.io/shiftmate-web/?unlocked=YOUR_CODE).
     */
    STRIPE_PAYMENT_LINK: '',

    /**
     * Lowercase SHA-256 hex of the unlock code (the same code you put in
     * the Stripe success URL). Generate with:
     *   node -e "crypto.subtle.digest('SHA-256', new TextEncoder().encode('YOUR_CODE')).then(b=>console.log(Buffer.from(b).toString('hex')))"
     * Leave empty until you choose a code.
     */
    UNLOCK_CODE_SHA256: '',

    /** Free-tier rota cap, counted from today, when UNLOCK_ENABLED is true. */
    FREE_ROTA_WEEKS_AHEAD: 4,

    STORAGE_KEY: 'shiftmate-uk-v1',
    UNLOCK_STORAGE_KEY: 'shiftmate-uk-unlock-v1',
    EXPORT_APP: 'shiftmate-uk-web',
    EXPORT_VERSION: 1,
  };
})(typeof window !== 'undefined' ? window : globalThis);
