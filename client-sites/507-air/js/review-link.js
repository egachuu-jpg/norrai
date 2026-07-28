/*
  507 Air — Google review link.

  The "leave a review" CTAs (the Reviews section on index.html and the footer
  link on every page) are hidden in the markup and only revealed by this script
  once PLACE_ID below holds a real Google Business Profile Place ID.

  TO TURN THE REVIEW LINKS ON: set PLACE_ID to the profile's Place ID — that is
  the only edit needed; all five pages read this one file. Find the ID in
  Google Business Profile Manager, or with Google's Place ID Finder:
  https://developers.google.com/maps/documentation/places/web-service/place-id

  Leaving it empty is the safe state: no CTA renders, so nobody can click
  through to a Google 404 while the profile is still unverified.
*/
(function () {
  var PLACE_ID = '';

  if (!PLACE_ID) return;

  var url = 'https://search.google.com/local/writereview?placeid=' + encodeURIComponent(PLACE_ID);

  document.querySelectorAll('a[data-review-url]').forEach(function (a) {
    a.setAttribute('href', url);
  });
  document.querySelectorAll('[data-review-cta]').forEach(function (el) {
    el.hidden = false;
  });
})();
