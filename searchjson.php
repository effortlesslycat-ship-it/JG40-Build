<?php
/**
 * searchjson.php — JSON-returning version of jgform.php
 * ======================================================
 *
 * Endpoint that takes the same POST/GET parameters as jgform.php and
 * returns the per-database hit counts as JSON instead of rendered HTML.
 *
 * Drop this file at: \\jewishgen6\JEWISHGEN\wwwroot\databases\searchjson.php
 *
 * Mirrors the form contract from /databases/all/index.asp and
 * SearchForm_solr.txt:
 *   - srch1..srch4         (search text)
 *   - srch1v..srch4v       (S/G/T/X — Surname/GivenName/Town/AnyField)
 *   - srch1t..srch4t       (Q/D/S/E/F1/F2/FM — match type)
 *   - SrchBOOL             (AND or OR)
 *   - allcountry           (region alias, e.g. ALLPOLAND)
 *   - GeoRegion            (sub-region; preferred over allcountry)
 *   - dates                (all or some)
 *   - Months, Years        (when dates=some)
 *
 * v1 SCOPE — what this DOES NOT do (intentional, to be added later):
 *   - Does not query JGFF, FTJP, JRI Solr cores (jgform.php hits 5 cores total)
 *   - Does not call external partner APIs (Yad Vashem, IGRA, Shapell,
 *     Gesher Galicia)
 *   - Does not log to MySQL jg_log (logging parity can be added by
 *     including cureetc.php and calling write_mysql_jglog())
 *   - Does not require login (matches jgform.php's public-search behavior)
 *
 * @author  JG40 redesign project (Caitlin + Claude)
 * @version 1.0 — initial draft
 */

// -----------------------------------------------------------------------------
// 1. HEADERS
// -----------------------------------------------------------------------------

// CORS — allow the GitHub Pages build domain during development.
// TODO: remove or tighten before go-live.
$allowedOrigins = [
    'https://effortlesslycat-ship-it.github.io',
    'https://www.jewishgen.org',
];
$origin = isset($_SERVER['HTTP_ORIGIN']) ? $_SERVER['HTTP_ORIGIN'] : '';
if (in_array($origin, $allowedOrigins, true)) {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type');
}

// Preflight short-circuit
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

header('Content-Type: application/json; charset=utf-8');

// -----------------------------------------------------------------------------
// 2. DEPENDENCIES
// -----------------------------------------------------------------------------

// dbconfig.php defines $DBgeneral (MySQL) and CUREDB constant.
// The Solr constants (SOLR_SERVER_HOSTNAME, etc.) come from a separate
// config file — adjust the path if it lives elsewhere on the server.
$docroot = isset($_SERVER['DOCUMENT_ROOT']) ? $_SERVER['DOCUMENT_ROOT'] : __DIR__;

require_once $docroot . '/databases/dbconfig.php';

// The Solr config file location may vary — try the most likely path first.
// If your Solr constants are defined in bootstrap.php or elsewhere,
// update this path.
$solrConfigCandidates = [
    $docroot . '/databases/bootstrap.php',
    $docroot . '/databases/solrconfig.php',
    $docroot . '/global/solr_config.php',
];
foreach ($solrConfigCandidates as $candidate) {
    if (file_exists($candidate)) {
        require_once $candidate;
        break;
    }
}

if (!defined('SOLR_SERVER_HOSTNAME')) {
    respondError(500, 'CONFIG_MISSING', 'Solr config not loaded — adjust $solrConfigCandidates in searchjson.php');
}

// -----------------------------------------------------------------------------
// 3. INPUT — read params from POST or GET (mirroring jgform.php)
// -----------------------------------------------------------------------------

$src = $_POST ?: $_GET;

function getParam($name, $default = '') {
    global $src;
    return isset($src[$name]) ? trim($src[$name]) : $default;
}

$rows = [];
for ($i = 1; $i <= 4; $i++) {
    $rows[$i] = [
        'value'      => getParam('srch' . $i),
        'dataType'   => getParam('srch' . $i . 'v'),   // S/G/T/X
        'searchType' => getParam('srch' . $i . 't'),   // Q/D/S/E/F1/F2/FM
    ];
}

$srchBool   = strtoupper(getParam('SrchBOOL', 'AND'));
if ($srchBool !== 'OR') { $srchBool = 'AND'; }

$allcountry = getParam('allcountry', '0*');
$geoRegion  = getParam('GeoRegion');
$dates      = getParam('dates', 'all');
$months     = getParam('Months');
$years      = getParam('Years');

// jgform.php logic: prefer GeoRegion if set, fall back to allcountry.
$region = strtolower($geoRegion !== '' ? $geoRegion : $allcountry);

// -----------------------------------------------------------------------------
// 4. INPUT VALIDATION
// -----------------------------------------------------------------------------
// Replicates the contract of cureetc.php's valid():
//   - empty is OK (means "this row not used")
//   - non-empty must be ≥3 chars after stripping wildcards
//
// We don't enforce jgform.php's strict character whitelist here because
// Solr handles UTF-8 natively and the form already filters via maxlength=25.

function isValidTerm($term) {
    if ($term === '') { return null; }   // empty = unused row
    $stripped = preg_replace('/[*?%#\[\]\s]/u', '', $term);
    if (mb_strlen($stripped) < 3) { return false; }
    return true;
}

$activeRows = [];
foreach ($rows as $i => $r) {
    $valid = isValidTerm($r['value']);
    if ($valid === false) {
        respondError(400, 'VALIDATION_FAILED',
            'Row ' . $i . ': search term must be at least 3 allowed characters.');
    }
    if ($valid === true && $r['dataType'] !== '') {
        $activeRows[] = $r;
    }
}

if (count($activeRows) === 0) {
    respondError(400, 'NO_SEARCH_TERMS', 'At least one search row must contain a valid term.');
}

// -----------------------------------------------------------------------------
// 5. BUILD SOLR QUERY
// -----------------------------------------------------------------------------
// Field mapping (from jgform.php):
//   S = surname     → record_surnames
//   G = given name  → record_givennames
//   T = town        → record_towns
//   X = any field   → all_text
//
// Search-type suffix (appended to field, except for X):
//   Q (phonetic)    → _bmpm
//   D (sounds like) → _dm
//   E (exact)       → no suffix
//   S (starts with) → no suffix, append '*' to value
//   F1/F2/FM (fuzzy)→ no suffix, append '~N' to value

function buildFieldClause($row) {
    $dataType   = $row['dataType'];
    $searchType = $row['searchType'];
    $term       = $row['value'];

    $fieldMap = [
        'S' => 'record_surnames',
        'G' => 'record_givennames',
        'T' => 'record_towns',
        'X' => 'all_text',
    ];
    if (!isset($fieldMap[$dataType])) { return null; }
    $field = $fieldMap[$dataType];

    // For "Any Field" (X), search is just contains-style on all_text.
    if ($dataType === 'X') {
        // Wrap single-word terms with wildcards for substring match.
        if (strpos($term, ' ') === false) {
            $term = '*' . $term . '*';
        } else {
            $term = '"' . $term . '"';
        }
        return $field . ':' . $term;
    }

    // Multi-word handling: jgform.php wraps in parens + AND.
    if (strpos($term, ' ') !== false) {
        $term = '(' . str_replace(' ', ' AND ', $term) . ')';
    }

    switch (substr($searchType, 0, 1)) {
        case 'Q': // phonetic — Beider-Morse
            return $field . '_bmpm:' . $term;

        case 'D': // D-M soundex
            return $field . '_dm:' . $term;

        case 'E': // exact
            return $field . ':' . $term;

        case 'S': // starts with
            return $field . ':' . $term . '*';

        case 'F': // fuzzy variants (F1, F2, FM)
            $len = substr($searchType, 1, 1);
            if ($len === 'M' || $len > 4) { $len = min(round(strlen($term) / 3), 4); }
            return $field . ':' . $term . '~' . $len;

        default:
            // No search type chosen — fall back to phonetic.
            return $field . '_bmpm:' . $term;
    }
}

$clauses = [];
foreach ($activeRows as $row) {
    $clause = buildFieldClause($row);
    if ($clause !== null) {
        $clauses[] = '(' . $clause . ')';
    }
}

$mainQuery = implode(' ' . $srchBool . ' ', $clauses);

// Region filter
if ($region !== '0*' && $region !== '00all' && $region !== 'all' && $region !== '') {
    // Match jgform.php behavior — strip the JOWBR cemetery prefix if present.
    $region = str_replace('01jowbr_99', '', $region);
    $mainQuery .= ' AND regionsdecoded:' . $region;
}

// Test-data filter (jgform.php's default is to exclude test records)
$mainQuery .= ' AND test:0';

// Date filter
if ($dates === 'some' && $months !== '' && $years !== '') {
    $months = str_pad((int)$months, 2, '0', STR_PAD_LEFT);
    $years  = (int)$years;
    if ($years > 1900 && $years < 2100) {
        $mainQuery .= ' AND filedate:[' . $years . '-' . $months . '-01T00:00:00Z TO NOW]';
    }
}

// -----------------------------------------------------------------------------
// 6. RUN SOLR QUERY
// -----------------------------------------------------------------------------

try {
    $solrOptions = [
        'hostname' => SOLR_SERVER_HOSTNAME,
        'login'    => SOLR_SERVER_USERNAME,
        'password' => SOLR_SERVER_PASSWORD,
        'port'     => SOLR_SERVER_PORT,
        'path'     => 'solr/JewishGen',
        'timeout'  => defined('SOLR_SERVER_TIMEOUT') ? SOLR_SERVER_TIMEOUT : 10,
    ];
    $client = new SolrClient($solrOptions);

    $query = new SolrQuery($mainQuery);
    $query->setRows(0);  // we only want facet counts, not records
    $query->setFacet(true);
    $query->addFacetField('solrtitle')->setFacetMinCount(1)->setFacetSort(0);
    $query->setFacetLimit(2000);

    $response = $client->query($query)->getResponse();

} catch (Exception $e) {
    respondError(502, 'SOLR_ERROR', 'Solr query failed: ' . $e->getMessage());
}

$totalMatches = isset($response->response->numFound) ? (int)$response->response->numFound : 0;
$facets       = isset($response->facet_counts->facet_fields->solrtitle)
                ? $response->facet_counts->facet_fields->solrtitle
                : null;

// -----------------------------------------------------------------------------
// 7. PARSE FACETS INTO STRUCTURED DATABASES
// -----------------------------------------------------------------------------
// Each facet key has the shape "[df_id]<a href=\"url\">Title</a>"
// We extract df_id, info_url, and a clean title.

function parseSolrTitle($raw) {
    $result = ['df_id' => '', 'info_url' => '', 'title' => $raw];

    if (preg_match('/^\[([^\]]+)\](.*)$/s', $raw, $m)) {
        $result['df_id'] = $m[1];
        $rest = $m[2];
    } else {
        $rest = $raw;
    }

    if (preg_match('/<a\s+href=["\']([^"\']+)["\'][^>]*>(.*?)<\/a>/i', $rest, $m)) {
        $result['info_url'] = $m[1];
        $result['title']    = trim(strip_tags($m[2]));
    } else {
        $result['title'] = trim(strip_tags($rest));
    }

    return $result;
}

// -----------------------------------------------------------------------------
// 8. GROUP BY RESEARCH DIVISION
// -----------------------------------------------------------------------------
// jgform.php derives the RD name from the database's info URL path
// (e.g. /databases/AustriaCzech/... → AUSTRIA-CZECH). We replicate the
// same logic plus the special-case mappings.

function deriveResearchDivision($infoUrl, $title) {
    $rd = '';
    $pos = strpos(strtolower($infoUrl), '/databases/');
    if ($pos !== false) {
        $tail = substr($infoUrl, $pos + 11);
        $rd   = strtoupper(strtok(strtok($tail, '/'), '"'));
    } elseif ($infoUrl !== '') {
        $parts = explode('/', $infoUrl);
        if (count($parts) > 1) {
            $rd = strtoupper($parts[count($parts) - 2]);
        }
    }

    // Special-case re-grouping (lifted from jgform.php switch statement)
    $remap = [
        'AUSTRIACZECH'              => 'AUSTRIA-CZECH',
        'LITVAK'                    => 'LITHUANIA',
        'LISTS'                     => 'BELARUS',
        'ARCHIVES-AND-REPOSITORIES' => 'RUSSIA',
        'VSIA'                      => 'RUSSIA',
        'BIALYGEN'                  => 'RUSSIA',
        'MISC'                      => 'RUSSIA',
        'SAFRICA'                   => 'SOUTH AFRICA',
        'BESSARABIA'                => 'BESSARABIA / TRANSNISTRIA',
        'LATINAMERICA'              => 'LATIN AMERICA',
        'SYRIA'                     => 'SEPHARDIC',
        'ITALY'                     => 'SEPHARDIC',
        'JCR-UK'                    => 'UNITED KINGDOM',
        'UK'                        => 'UNITED KINGDOM',
        'HOLOCAUST'                 => 'JewishGen Holocaust Database',
        'GIVENNAMES'                => 'JewishGen Given Names Database',
        'CEMETERY'                  => 'JewishGen Online Worldwide Burial Registry',
        'MEMORIAL'                  => 'JewishGen Memorials & Plaques Database',
        'YIZKOR'                    => 'The JewishGen Yizkor Book Necrology Database',
        'AROLSEN'                   => 'Arolsen Archives Database',
    ];
    if (isset($remap[$rd])) { $rd = $remap[$rd]; }
    return $rd ?: 'OTHER';
}

$grouped = [];

if ($facets !== null) {
    foreach ($facets as $raw => $count) {
        if ($count <= 0) { continue; }
        $parsed = parseSolrTitle($raw);
        $rd     = deriveResearchDivision($parsed['info_url'], $parsed['title']);
        if (!isset($grouped[$rd])) { $grouped[$rd] = []; }
        $grouped[$rd][] = [
            'df_id'    => $parsed['df_id'],
            'title'    => $parsed['title'],
            'info_url' => $parsed['info_url'],
            'count'    => (int)$count,
        ];
    }
}

// Sort each RD's databases by title, and RDs themselves alphabetically.
foreach ($grouped as $rd => $dbs) {
    usort($grouped[$rd], function($a, $b) {
        return strcmp(strtolower($a['title']), strtolower($b['title']));
    });
}
ksort($grouped);

// Convert assoc array to indexed list for JSON.
$researchDivisions = [];
foreach ($grouped as $name => $dbs) {
    $researchDivisions[] = [
        'name'      => $name,
        'databases' => $dbs,
    ];
}

// -----------------------------------------------------------------------------
// 9. BUILD HUMAN-READABLE SEARCH SUMMARY
// -----------------------------------------------------------------------------

$summaryParts = [];
$dataTypeLabel = [
    'S' => 'Surname',
    'G' => 'Given Name',
    'T' => 'Town',
    'X' => 'Any Field',
];
$searchTypeLabel = [
    'Q'  => 'phonetically like',
    'D'  => 'sounds like',
    'E'  => 'is exactly',
    'S'  => 'starts with',
    'F1' => 'fuzzy',
    'F2' => 'fuzzier',
    'FM' => 'fuzziest',
];
foreach ($activeRows as $row) {
    $dt = isset($dataTypeLabel[$row['dataType']]) ? $dataTypeLabel[$row['dataType']] : $row['dataType'];
    $st = isset($searchTypeLabel[$row['searchType']]) ? $searchTypeLabel[$row['searchType']] : '';
    $summaryParts[] = $dt . ($st ? ' (' . $st . ')' : '') . ' : ' . strtoupper($row['value']);
}
$summary = implode(' ' . $srchBool . ' ', $summaryParts);

// -----------------------------------------------------------------------------
// 10. OUTPUT
// -----------------------------------------------------------------------------

echo json_encode([
    'search_summary' => [
        'description'   => $summary,
        'ran_at'        => date('c'),
        'total_matches' => $totalMatches,
        'region'        => $region,
        'srch_bool'     => $srchBool,
    ],
    'research_divisions' => $researchDivisions,
    // TODO v2 — add partner sources here once we wire up the secondary cores
    // and external APIs:
    // 'partner_sources' => [
    //     'family_finder' => [...],
    //     'ftjp'          => [...],
    //     'jri_poland'    => [...],
    //     'yad_vashem'    => [...],
    //     'igra'          => [...],
    //     'shapell'       => [...],
    //     'gesher_galicia'=> [...],
    // ],
], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);

// -----------------------------------------------------------------------------
// UTILITIES
// -----------------------------------------------------------------------------

function respondError($httpCode, $code, $message) {
    http_response_code($httpCode);
    echo json_encode([
        'error'   => $message,
        'code'    => $code,
    ]);
    exit;
}
