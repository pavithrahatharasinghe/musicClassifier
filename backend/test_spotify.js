const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { SpotifyService } = require('./dist/services/spotify.js');

async function run() {
  const service = new SpotifyService();
  const url = await service.findTrackUrl("blinding lights");
  console.log("URL:", url);
  // how to get preview?
}
run().catch(console.error);
