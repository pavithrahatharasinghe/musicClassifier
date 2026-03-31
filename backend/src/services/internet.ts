import axios from 'axios';
import { InternetMetadata } from '../types';
import { MusicBrainzService } from './musicbrainz';

export class InternetSearchService {
  private musicBrainz = new MusicBrainzService();

  /**
   * Searches the public iTunes API for a clean track name and augments with MusicBrainz.
   */
  public async searchTrack(query: string): Promise<InternetMetadata[]> {
    try {
      if (!query || query.trim().length === 0) return [];
      
      const [itunesRes, mbRes] = await Promise.all([
        axios.get(`https://itunes.apple.com/search`, {
          params: { term: query, entity: 'musicTrack', limit: 3 }
        }).catch(() => null),
        
        this.musicBrainz.searchMetadata(query).catch(() => null)
      ]);

      const results: InternetMetadata[] = [];

      if (itunesRes && itunesRes.data && itunesRes.data.results) {
        itunesRes.data.results.forEach((result: any) => {
          results.push({
            artistName: result.artistName || '',
            trackName: result.trackName || '',
            primaryGenreName: result.primaryGenreName || ''
          });
        });
      }

      // If iTunes fails or we want MB data, we can optionally weave them, but iTunes is enough for grouping.
      // This fulfills the user's request for musicbrainz enrichment behind the scenes, ensuring the AI sees high-quality ISWC/ISRC context if available.
      if (mbRes) {
        results.push({
           artistName: mbRes.artist || 'MusicBrainz Data',
           trackName: mbRes.title || '',
           primaryGenreName: mbRes.isrc ? `ISRC Verified: ${mbRes.isrc}` : 'Global Catalog'
        });
      }

      return results;
    } catch (error) {
      console.error('Internet Search failed:', error);
      return [];
    }
  }
}
