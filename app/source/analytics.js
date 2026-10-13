'use strict';
// Vercel Web Analytics initialization
// This script initializes Vercel's Web Analytics for tracking page views and events.
// The actual analytics script is injected by Vercel's infrastructure when deployed.

(function() {
  // Initialize Vercel Analytics using the standard window.va pattern
  // This follows the Vercel Analytics documentation for vanilla JavaScript projects
  window.va = window.va || function() {
    (window.vaq = window.vaq || []).push(arguments);
  };

  // Track initial page view
  if (typeof window.va === 'function') {
    window.va('pageview');
  }

  // Optional: Track custom events when the app initializes
  // This can be extended to track specific user interactions
  console.log('[Analytics] Vercel Web Analytics initialized');
})();
