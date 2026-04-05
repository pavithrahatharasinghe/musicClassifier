import axios from 'axios';

export interface MusicBrainzData {
  title: string;
  artist: string;
  isrc?: string | null;
  releaseYear?: string | null;
}

export class MusicBrainzService {
  /**
   * Search MusicBrainz public API for high-fidelity metadata.
   * Note: The API allows anonymous requests but requires a proper User-Agent.
   */
  public async searchMetadata(query: string): Promise<MusicBrainzData | null> {
    try {
      const response = await axios.get('https://musicbrainz.org/ws/2/recording/', {
        params: {
          query: `recording:"${query}"`,
          fmt: 'json',
          limit: 1
        },
        headers: {
          'User-Agent': 'MusicClassifier/4.0 ( media@example.com )'
        }
      });

      if (response.data && response.data.recordings && response.data.recordings.length > 0) {
        const record = response.data.recordings[0];
        const artist = record['artist-credit']?.[0]?.name || '';
        const title = record.title || '';
        const isrc = record.isrcs?.[0] || null;
        const releaseYear = record.releases?.[0]?.date?.substring(0, 4) || null;

        return { artist, title, isrc, releaseYear };
      }
      return null;
    } catch (error) {
      console.error('MusicBrainz API Error:', error);
      return null;
    }
  }

  /**
   * Check whether a recording has a video release on MusicBrainz.
   * Queries the recording API with URL relations and checks for music video links.
   * Returns 'available', 'unavailable', or 'unknown' (on error / no results).
   */
  public async checkVideoRelease(query: string): Promise<'available' | 'unavailable' | 'unknown'> {
    try {
      const response = await axios.get('https://musicbrainz.org/ws/2/recording/', {
        params: {
          query: `recording:"${query}"`,
          fmt: 'json',
          limit: 5,
          inc: 'url-rels'
        },
        headers: {
          'User-Agent': 'MusicClassifier/4.0 ( media@example.com )'
        }
      });

      if (!response.data?.recordings?.length) {
        return 'unknown';
      }

      for (const recording of response.data.recordings) {
        const relations: any[] = recording.relations || [];
        const hasVideoRelation = relations.some(
          (rel: any) => rel.type === 'music video' || rel.type === 'video streaming'
        );
        if (hasVideoRelation) {
          return 'available';
        }
      }

      return 'unavailable';
    } catch (error) {
      console.error('MusicBrainz video release check error:', error);
      return 'unknown';
    }
  }
}
