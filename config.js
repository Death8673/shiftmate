/** ShiftMate UK site configuration. Keep checkout off until paid purchases can be verified and restored. */
(function (global) {
  'use strict';

  global.ShiftMateConfig = {
    UNLOCK_ENABLED: false,
    UNLOCK_PRICE: '£4.99',
    UNLOCK_PRICE_LABEL: 'one-off',
    STRIPE_PAYMENT_LINK: '',
    UNLOCK_CODE_SHA256: '',
    FREE_ROTA_WEEKS_AHEAD: 4,
    STORAGE_KEY: 'shiftmate-uk-v1',
    UNLOCK_STORAGE_KEY: 'shiftmate-uk-unlock-v1',
    EXPORT_APP: 'shiftmate-uk-web',
    EXPORT_VERSION: 1,
  };
})(typeof window !== 'undefined' ? window : globalThis);
