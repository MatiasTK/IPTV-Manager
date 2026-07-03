'use strict';

/**
 * M3U / M3U8 Parser
 *
 * Parses Extended M3U playlist text into an array of channel objects.
 * Handles: #EXTM3U header attributes, #EXTINF per-channel attributes,
 *          #EXTVLCOPT tags (user-agent, referrer), and stream URLs.
 */

/**
 * Parse the key="value" (or key=value) attribute string from a line.
 * @param {string} attrString - raw attribute string
 * @returns {Object} parsed key-value pairs
 */
function parseAttributes(attrString) {
  const attrs = {};
  // Match key="value" or key='value' or key=value (no quotes)
  const re = /([\w-]+)=(?:"([^"]*)"|'([^']*)'|([^\s,]+))/g;
  let m;
  while ((m = re.exec(attrString)) !== null) {
    const key = m[1].toLowerCase();
    const value = m[2] !== undefined ? m[2]
      : m[3] !== undefined ? m[3]
      : m[4];
    attrs[key] = value;
  }
  return attrs;
}

/**
 * Parse #EXTM3U header line for global attributes.
 * @param {string} line
 * @returns {Object} header attributes
 */
function parseHeader(line) {
  const attrStr = line.replace(/^#EXTM3U\s*/i, '');
  const attrs = parseAttributes(attrStr);
  return {
    epgUrls: [attrs['x-tvg-url'] || attrs['url-tvg'] || ''].filter(Boolean),
    cache: attrs['cache'] || '',
  };
}

/**
 * Parse an #EXTINF line.
 * Format: #EXTINF:<duration> [attributes],<display name>
 * @param {string} line
 * @returns {Object} { duration, displayName, attributes }
 */
function parseExtInf(line) {
  // Split on last comma to get display name (after all attributes)
  const commaIdx = line.lastIndexOf(',');
  const displayName = commaIdx !== -1 ? line.slice(commaIdx + 1).trim() : '';
  const head = commaIdx !== -1 ? line.slice(0, commaIdx) : line;

  // Extract duration (number after #EXTINF:)
  const durationMatch = head.match(/^#EXTINF:\s*(-?\d+(?:\.\d+)?)/i);
  const duration = durationMatch ? parseFloat(durationMatch[1]) : -1;

  // Everything after duration number is attributes
  const attrStr = durationMatch
    ? head.slice(durationMatch[0].length).trim()
    : head.replace(/^#EXTINF:/i, '').trim();

  const attrs = parseAttributes(attrStr);

  return {
    duration,
    displayName,
    tvgId: attrs['tvg-id'] || '',
    tvgName: attrs['tvg-name'] || '',
    tvgLogo: attrs['tvg-logo'] || '',
    groupTitle: attrs['group-title'] || '',
    tvgChno: attrs['tvg-chno'] || '',
    tvgShift: attrs['tvg-shift'] || '',
    catchup: attrs['catchup'] || '',
    catchupSource: attrs['catchup-source'] || '',
    catchupDays: parseInt(attrs['catchup-days'] || '0', 10),
    httpUserAgent: attrs['http-user-agent'] || '',
    parentCode: attrs['parent-code'] || '',
  };
}

/**
 * Detect if a channel is VOD (movie/series) based on URL or group-title.
 * @param {Object} extInf
 * @param {string} urlStr
 * @returns {boolean}
 */
function isVod(extInf, urlStr) {
  try {
    const url = new URL(urlStr);
    const pathname = url.pathname.toLowerCase();
    if (/\.(mp4|mkv|avi|mov|flv|wmv|mpg|mpeg)$/.test(pathname)) return true;

    const segments = pathname.split('/');
    if (segments.includes('movie') || segments.includes('movies') || segments.includes('series')) {
      return true;
    }
  } catch {
    const cleanUrl = urlStr.split('?')[0].toLowerCase();
    if (/\.(mp4|mkv|avi|mov|flv|wmv|mpg|mpeg)$/.test(cleanUrl)) return true;
  }

  if (extInf && extInf.groupTitle) {
    const gt = extInf.groupTitle.toLowerCase();
    // Match keywords like peliculas, películas, movies, series, vod, cinema
    if (/\b(peliculas|películas|movies|cinema|series|vod|shows)\b/i.test(gt)) {
      return true;
    }
  }

  return false;
}

/**
 * Parse a full M3U text string.
 * @param {string} text - raw M3U content
 * @returns {{ header: Object, channels: Array }}
 */
function parseM3U(text) {
  // Normalize line endings
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  let header = { epgUrls: [], cache: '' };
  const channels = [];

  let currentExtInf = null;
  let pendingUserAgent = '';
  let pendingReferrer = '';
  let lineIndex = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (i === 0 && /^#EXTM3U/i.test(line)) {
      header = parseHeader(line);
      lineIndex = 1;
      continue;
    }

    if (!line || line === '') continue;

    if (/^#EXTINF:/i.test(line)) {
      currentExtInf = parseExtInf(line);
      pendingUserAgent = '';
      pendingReferrer = '';
      continue;
    }

    // VLC options between #EXTINF and URL
    if (/^#EXTVLCOPT:/i.test(line)) {
      const val = line.replace(/^#EXTVLCOPT:/i, '').trim();
      if (/^http-user-agent=/i.test(val)) {
        pendingUserAgent = val.replace(/^http-user-agent=/i, '').trim();
      } else if (/^http-referrer=/i.test(val)) {
        pendingReferrer = val.replace(/^http-referrer=/i, '').trim();
      }
      continue;
    }

    // Skip other directives
    if (line.startsWith('#')) continue;

    // This is a URL — combine with pending EXTINF
    if (currentExtInf) {
      if (!isVod(currentExtInf, line)) {
        const ua = currentExtInf.httpUserAgent || pendingUserAgent;
        const ref = pendingReferrer;

        channels.push({
          name: currentExtInf.displayName || currentExtInf.tvgName || 'Unknown Channel',
          url: line,
          tvgId: currentExtInf.tvgId,
          tvgName: currentExtInf.tvgName,
          tvgLogo: currentExtInf.tvgLogo,
          groupTitle: currentExtInf.groupTitle,
          catchup: currentExtInf.catchup,
          catchupSource: currentExtInf.catchupSource,
          catchupDays: currentExtInf.catchupDays,
          httpUserAgent: ua,
          referrer: ref,
        });
      }

      currentExtInf = null;
      pendingUserAgent = '';
      pendingReferrer = '';
    } else {
      // Bare URL without EXTINF
      if (!isVod(null, line)) {
        channels.push({
          name: 'Unknown Channel',
          url: line,
          tvgId: '',
          tvgName: '',
          tvgLogo: '',
          groupTitle: '',
          catchup: '',
          catchupSource: '',
          catchupDays: 0,
          httpUserAgent: '',
          referrer: '',
        });
      }
    }
  }

  return { header, channels };
}

module.exports = { parseM3U };
