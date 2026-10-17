// Connects the site to the "clubcom" Supabase project.
// The publishable key is meant to be public; it is safe in browser code.
const SUPABASE_URL = "https://jpwrjylnlezbkqzsjxjl.supabase.co";
const SUPABASE_KEY = "sb_publishable_WCE3REDmhOPmS-BH9yL7Ew_N75MUXol";

window.db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

window.showMessage = function (el, text, kind) {
  el.textContent = text;
  el.className = "message " + kind;
  el.hidden = false;
};

window.friendlyError = function (error) {
  const msg = (error && error.message) || "Something went wrong. Please try again.";
  if (/invalid login credentials/i.test(msg)) return "That email or password is wrong. Check them and try again.";
  if (/email not confirmed/i.test(msg)) return "Confirm your email first. Open the link we sent you, then log in.";
  if (/already registered/i.test(msg)) return "An account with this email already exists. Log in instead.";
  if (/password should be at least/i.test(msg)) return "Your password needs at least 6 characters.";
  if (/rate limit/i.test(msg)) return "Too many tries in a short time. Wait a few minutes and try again.";
  return msg;
};
