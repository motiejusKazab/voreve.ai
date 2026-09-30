/*
  Voreve.ai — site configuration.
  Fill these in when they exist. Nothing is invented: while a value is empty,
  the site shows an honest "not connected yet" state instead.

  BOOKING_URL    Calendar link (Cal.com, Calendly, Google Calendar appointment page…).
                 When set, it is embedded in the #demo section (with an "open in new tab" link).
  CONTACT_EMAIL  The team's real email address. Enables every "Email us" link,
                 the copy button, and the mailto fallback of the demo form.
  FORM_ENDPOINT  Optional. A form backend URL (Formspree, Basin, your own API). The demo form
                 POSTs JSON here. If empty, the form falls back to a mailto draft (needs CONTACT_EMAIL).
*/
window.VOREVE_CONFIG = {
  BOOKING_URL: "",
  CONTACT_EMAIL: "",
  FORM_ENDPOINT: ""
};
