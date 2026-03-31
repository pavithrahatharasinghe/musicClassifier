import axios from 'axios';

export class SpotifyService {
  private accessToken: string | null = null;
  private tokenExpiry: number = 0;

  private get clientId(): string {
    return process.env.SPOTIFY_CLIENT_ID || '';
  }

  private get clientSecret(): string {
    return process.env.SPOTIFY_CLIENT_SECRET || '';
  }

  private async getAccessToken(): Promise<string | null> {
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    if (!this.clientId || !this.clientSecret) {
      console.error('Spotify credentials not configured. Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in your environment.');
      return null;
    }

    try {
      const credentials = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
      const res = await axios.post(
        'https://accounts.spotify.com/api/token',
        new URLSearchParams({ grant_type: 'client_credentials' }).toString(),
        {
          headers: {
            Authorization: `Basic ${credentials}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );
      this.accessToken = res.data.access_token;
      // Refresh 60 seconds before actual expiry to avoid using a token that expires mid-request
      this.tokenExpiry = Date.now() + (res.data.expires_in - 60) * 1000;
      return this.accessToken;
    } catch (error) {
      console.error('Failed to get Spotify access token:', error);
      return null;
    }
  }

  /**
   * Searches Spotify for a track matching the provided song name and returns
   * the canonical track URL in the format https://open.spotify.com/track/{id}.
   */
  public async findTrackUrl(songName: string): Promise<string | null> {
    try {
      const token = await this.getAccessToken();
      if (!token) return null;

      const res = await axios.get('https://api.spotify.com/v1/search', {
        params: {
          q: songName,
          type: 'track',
          limit: 1,
        },
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const tracks = res.data?.tracks?.items;
      if (tracks && tracks.length > 0) {
        const trackId = tracks[0].id;
        return `https://open.spotify.com/track/${trackId}`;
      }
      return null;
    } catch (error) {
      console.error('Spotify search failed:', error);
      return null;
    }
  }
}
