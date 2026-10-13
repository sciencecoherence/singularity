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

  // Optional: Track custom events when the app initializes
  // This can be extended to track specific user interactions
  // Note: Pageviews are automatically tracked by Vercel Analytics when the actual
  // script loads, so no manual pageview call is needed here
})();
