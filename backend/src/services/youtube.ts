import yts from 'yt-search';

export class YouTubeService {
  /**
   * Searches YouTube for an official music video of the provided track name.
   * Uses yt-search which crawls youtube natively without requiring an API Key.
   */
  public async findOfficialVideoSync(songName: string): Promise<string | null> {
    try {
      const query = `${songName} Official Music Video`;
      const result = await yts(query);
      
      if (result && result.videos && result.videos.length > 0) {
        // Return the first valid youtube video URL
        return result.videos[0].url;
      }
      return null;
    } catch (error) {
      console.error('YouTube Search Failed:', error);
      return null;
    }
  }
}
