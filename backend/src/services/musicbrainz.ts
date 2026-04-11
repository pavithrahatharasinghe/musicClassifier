import axios from 'axios';

const MB_HEADERS = {
  'User-Agent': 'MusicClassifier/4.0 ( media@example.com )'
};

const MB_BASE = 'https://musicbrainz.org/ws/2';

export interface MusicBrainzData {
  title: string;
  artist: string;
  isrc?: string | null;
  releaseYear?: string | null;
}

export class MusicBrainzService {
  /**
   * Search MusicBrainz public API for high-fidelity metadata.
   */
  public async searchMetadata(query: string): Promise<MusicBrainzData | null> {
    try {
      const response = await axios.get(`${MB_BASE}/recording/`, {
        params: { query: `recording:"${query}"`, fmt: 'json', limit: 1 },
        headers: MB_HEADERS
      });

      if (response.data?.recordings?.length > 0) {
        const record = response.data.recordings[0];
        return {
          artist: record['artist-credit']?.[0]?.name || '',
          title: record.title || '',
          isrc: record.isrcs?.[0] || null,
          releaseYear: record.releases?.[0]?.date?.substring(0, 4) || null,
        };
      }
      return null;
    } catch (error) {
      console.error('MusicBrainz API Error:', error);
      return null;
    }
  }

  /**
   * Check whether a recording has a music video release.
   *
   * Strategy:
   *  1. Search for the recording by name to get MusicBrainz IDs.
   *  2. For each candidate, fetch the individual recording with ?inc=url-rels
   *     (url-rels do NOT come back in the search endpoint, only on lookup).
   *  3. Look for relations of type 'music video' or 'video streaming'.
   *
   * Returns 'available', 'unavailable', or 'unknown' (on network error).
   */
  public async checkVideoRelease(query: string): Promise<'available' | 'unavailable' | 'unknown'> {
    try {
      // Step 1: Search for recordings by name (no inc= here — it doesn't work on search)
      const searchRes = await axios.get(`${MB_BASE}/recording/`, {
        params: { query: `recording:"${query}"`, fmt: 'json', limit: 5 },
        headers: MB_HEADERS
      });

      const recordings: any[] = searchRes.data?.recordings || [];

      if (recordings.length === 0) {
        // Try a looser query without quotes
        const looseRes = await axios.get(`${MB_BASE}/recording/`, {
          params: { query, fmt: 'json', limit: 5 },
          headers: MB_HEADERS
        });
        recordings.push(...(looseRes.data?.recordings || []));
      }

      if (recordings.length === 0) {
        return 'unavailable';
      }

      // Step 2: Lookup each recording individually with url-rels
      // MusicBrainz rate-limits to ~1 req/sec; check up to 3 to be safe
      const candidates = recordings.slice(0, 3);

      for (const rec of candidates) {
        try {
          // Add a small delay to respect the MB rate limit
          await new Promise(r => setTimeout(r, 350));

          const lookupRes = await axios.get(`${MB_BASE}/recording/${rec.id}`, {
            params: { fmt: 'json', inc: 'url-rels' },
            headers: MB_HEADERS
          });

          const relations: any[] = lookupRes.data?.relations || [];
          const hasVideo = relations.some(
            (rel: any) =>
              rel.type === 'music video' ||
              rel.type === 'video streaming' ||
              (rel.url?.resource && rel.url.resource.includes('youtube'))
          );

          if (hasVideo) return 'available';
        } catch (lookupErr) {
          // If a single lookup fails, continue to the next
          console.error(`MusicBrainz lookup failed for ${rec.id}:`, lookupErr);
        }
      }

      return 'unavailable';
    } catch (error) {
      console.error('MusicBrainz video release check error:', error);
      return 'unknown';
    }
  }
}
