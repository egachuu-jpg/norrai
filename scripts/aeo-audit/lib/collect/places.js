'use strict';

/**
 * Places API (New) collector — places.googleapis.com.
 *
 * - Place Details for clientConfig.place_id: rating, userRatingCount,
 *   photos count, regularOpeningHours, businessStatus (+ a couple of
 *   extra cheap fields: displayName, primaryTypeDisplayName,
 *   nationalPhoneNumber, used by scoring/site NAP-match).
 * - Text Search for clientConfig.competitor_search: top 3 by review count.
 *
 * Missing GOOGLE_PLACES_API_KEY -> whole collector skipped gracefully.
 * place_id: null -> client details skipped, competitor search still runs.
 */

const PLACE_DETAILS_URL = 'https://places.googleapis.com/v1/places';
const TEXT_SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText';
const FETCH_TIMEOUT_MS = 10000;

const DETAILS_FIELD_MASK = [
  'id',
  'displayName',
  'primaryTypeDisplayName',
  'nationalPhoneNumber',
  'rating',
  'userRatingCount',
  'businessStatus',
  'regularOpeningHours',
  'photos',
].join(',');

const SEARCH_FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.rating',
  'places.userRatingCount',
].join(',');

async function fetchWithTimeout(url, options, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchPlaceDetails(placeId, apiKey) {
  const res = await fetchWithTimeout(`${PLACE_DETAILS_URL}/${encodeURIComponent(placeId)}`, {
    method: 'GET',
    headers: {
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': DETAILS_FIELD_MASK,
    },
  });
  if (!res.ok) throw new Error(`Place Details HTTP ${res.status}`);
  const data = await res.json();
  return {
    place_id: data.id || placeId,
    name: data.displayName && data.displayName.text,
    primary_category: data.primaryTypeDisplayName && data.primaryTypeDisplayName.text,
    phone: data.nationalPhoneNumber || null,
    rating: typeof data.rating === 'number' ? data.rating : null,
    user_ratings_total: typeof data.userRatingCount === 'number' ? data.userRatingCount : 0,
    business_status: data.businessStatus || 'UNKNOWN',
    opening_hours_set: !!data.regularOpeningHours,
    photos_count: Array.isArray(data.photos) ? data.photos.length : 0,
  };
}

async function fetchCompetitors(textQuery, apiKey) {
  const res = await fetchWithTimeout(TEXT_SEARCH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': SEARCH_FIELD_MASK,
    },
    body: JSON.stringify({ textQuery }),
  });
  if (!res.ok) throw new Error(`Text Search HTTP ${res.status}`);
  const data = await res.json();
  const places = Array.isArray(data.places) ? data.places : [];
  return places
    .map((p) => ({
      name: p.displayName && p.displayName.text,
      place_id: p.id || null,
      rating: typeof p.rating === 'number' ? p.rating : null,
      review_count: typeof p.userRatingCount === 'number' ? p.userRatingCount : 0,
    }))
    .sort((a, b) => (b.review_count || 0) - (a.review_count || 0))
    .slice(0, 3);
}

/** @returns {Promise<object>} raw.places shape (see CONTRACT.md / scoring.js) */
async function collectPlaces(clientConfig) {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  const competitor_search = clientConfig.competitor_search || null;

  if (!apiKey) {
    return {
      skipped: true,
      reason: 'missing_api_key',
      client: null,
      competitors: [],
      competitor_search,
    };
  }

  const result = { skipped: false, client: null, competitors: [], competitor_search };

  if (clientConfig.place_id) {
    try {
      result.client = await fetchPlaceDetails(clientConfig.place_id, apiKey);
    } catch (err) {
      result.client = null;
      result.client_error = (err && err.message) || String(err);
    }
  }

  if (competitor_search) {
    try {
      result.competitors = await fetchCompetitors(competitor_search, apiKey);
    } catch (err) {
      result.competitors = [];
      result.competitors_error = (err && err.message) || String(err);
    }
  }

  return result;
}

module.exports = { collectPlaces, fetchPlaceDetails, fetchCompetitors };
