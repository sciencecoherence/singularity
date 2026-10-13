<?php
/**
 * Temporal Live — the one server-side file.
 *
 * A dumb allowlisted pass-through, deliberately not a parser. It exists for the
 * handful of sources that publish no Access-Control-Allow-Origin header and so
 * cannot be read by a browser directly: NASA GISTEMP, NSIDC, NOAA CPC and STAR,
 * Epoch AI, arXiv, ESA. Everything else the page fetches itself.
 *
 * It can also return only the tail of a response. That is not an optimisation:
 * the sea-ice record is 1.9 MB and the Epoch model list 1.1 MB, and a visitor
 * should not download either in full to read the last few rows.
 *
 * All parsing lives in the page's own JavaScript, so the website and the
 * desktop app share one implementation. The desktop app never calls this file.
 */

declare(strict_types=1);

const ALLOWED = [
    'data.giss.nasa.gov',
    'noaadata.apps.nsidc.org',
    'www.cpc.ncep.noaa.gov',
    'www.star.nesdis.noaa.gov',
    'epoch.ai',
    'export.arxiv.org',
    'www.esa.int',
    'www.sidc.be',
    'api.gdeltproject.org',
    'metr.org',
    'incidentdatabase.ai',
    'reliefweb.int',
    'www.aljazeera.com',
    'feeds.bbci.co.uk',
    'news.un.org',
    'celestrak.org',
    'lifespan.io',
    'ir.eia.gov',
    'www.eia.gov',
    'query1.finance.yahoo.com',
    'nominatim.openstreetmap.org',
    'news.google.com',
    'www.nhc.noaa.gov',
    'www.metoc.navy.mil',
    'unstats.un.org',
    'stats.bis.org',
    'api.imf.org',
    'cdn.jsdelivr.net',
    'api.nasa.gov',
    // Launch Library, only when it refuses a visitor's direct read (net.js).
    'll.thespacedevs.com',
];

// CelesTrak recomputes twice a day and asks clients not to download the same
// data repeatedly; its answers are kept six hours for every visitor at once.
const LONG_CACHE = ['celestrak.org' => 21600];

const MAX_BYTES   = 8 * 1024 * 1024;   // refuse anything absurd
const CACHE_TTL   = 900;               // 15 minutes; these sources update daily at best
const TIMEOUT_SEC = 25;

function fail(int $code, string $why): never {
    http_response_code($code);
    header('Content-Type: application/json');
    echo json_encode(['error' => $why]);
    exit;
}

$url = $_GET['url'] ?? '';
if ($url === '') fail(400, 'no url');

$parts = parse_url($url);
if ($parts === false || ($parts['scheme'] ?? '') !== 'https' || !isset($parts['host'])) {
    fail(400, 'url must be https');
}
if (!in_array($parts['host'], ALLOWED, true)) {
    fail(403, 'host not allowed');
}

$tail = isset($_GET['tail']) ? max(0, min((int)$_GET['tail'], MAX_BYTES)) : 0;
// Only the first N bytes, by range request (the conjunction list is 22 MB, sorted by risk).
$head = isset($_GET['head']) ? max(0, min((int)$_GET['head'], MAX_BYTES)) : 0;
$ttl  = LONG_CACHE[$parts['host']] ?? CACHE_TTL;

// A short disk cache, so a page open by several visitors in the same quarter
// hour costs the upstream source one request rather than one each.
$dir = sys_get_temp_dir() . '/temporal-live-cache';
if (!is_dir($dir)) @mkdir($dir, 0700, true);
$key  = $dir . '/' . hash('sha256', $url . '|' . $tail . '|' . $head);
$hit  = is_file($key) && (time() - filemtime($key) < $ttl);

if ($hit) {
    $body = file_get_contents($key);
} else {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS      => 3,
        CURLOPT_TIMEOUT        => TIMEOUT_SEC,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_USERAGENT      => 'TemporalLive/1.0 (Science Coherence instrument)',
        CURLOPT_HTTPHEADER     => ['Accept: */*'],
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
    ]);
    if ($head > 0) curl_setopt($ch, CURLOPT_RANGE, '0-' . ($head - 1));
    $body   = curl_exec($ch);
    $status = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $err    = curl_error($ch);
    curl_close($ch);

    if ($body === false)          fail(502, 'upstream unreachable: ' . substr($err, 0, 80));
    if ($status < 200 || $status >= 300) fail(502, 'upstream HTTP ' . $status);
    if ($head > 0 && strlen($body) > $head) $body = substr($body, 0, $head);
    if ($head > 0) { $nl = strrpos($body, "\n"); if ($nl !== false) $body = substr($body, 0, $nl + 1); }
    if (strlen($body) > MAX_BYTES) fail(502, 'response too large');

    if ($tail > 0 && strlen($body) > $tail) {
        // Cut at a line boundary so the page never has to parse half a row.
        $body = substr($body, -$tail);
        $nl = strpos($body, "\n");
        if ($nl !== false && $nl < 4096) $body = substr($body, $nl + 1);
    }
    @file_put_contents($key, $body, LOCK_EX);
}

header('Content-Type: text/plain; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Cache-Control: public, max-age=' . $ttl);
header('X-Content-Type-Options: nosniff');
echo $body;
