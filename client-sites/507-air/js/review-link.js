/*
  507 Air — Google review link.

  The "leave a review" CTAs (the Reviews section on index.html and the footer
  link on every page) are hidden in the markup and only revealed by this script
  once REVIEW_URL below holds a real Google review URL.

  TO TURN THE REVIEW LINKS ON: paste the URL below — that is the only edit
  needed; all five pages read this one file. Either form works:

    1. The "Get more reviews" short link from the Google Business Profile
       dashboard — https://g.page/r/<CID>/review
       (shortest, best for texting customers)

    2. Built from the profile's Place ID —
       https://search.google.com/local/writereview?placeid=<PLACE_ID>
       Find the Place ID in Business Profile Manager, or with Google's finder:
       https://developers.google.com/maps/documentation/places/web-service/place-id

  Leaving it empty is the safe state: no CTA renders, so nobody can click
  through to a Google 404 the way they could before this file existed.
  Whatever you paste, click it once yourself before deploying.
*/
(function () {
  var REVIEW_URL = 'https://g.page/r/CS6mxtsUw3ujEBM/review';

  if (!REVIEW_URL) return;

  document.querySelectorAll('a[data-review-url]').forEach(function (a) {
    a.setAttribute('href', REVIEW_URL);
  });
  document.querySelectorAll('[data-review-cta]').forEach(function (el) {
    el.hidden = false;
  });
})();
