/// <reference types="@fastly/js-compute" />
import { getGeolocationForIpAddress } from 'fastly:geolocation';
import { handleVisitorProfile } from './visitor-profile.js';

export function handleRequest(request) {
  return handleVisitorProfile(request, getGeolocationForIpAddress)
    || new Response(JSON.stringify({ error: 'Not Found' }), {
      status: 404,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'private, no-store',
        'surrogate-control': 'no-store',
        'x-content-type-options': 'nosniff',
      },
    });
}

addEventListener('fetch', (event) => event.respondWith(handleRequest(event.request)));
