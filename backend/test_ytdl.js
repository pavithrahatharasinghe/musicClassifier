const youtubedl = require('youtube-dl-exec');

async function check() {
  const result = await youtubedl('https://www.youtube.com/watch?v=ScMzIvxBSi4', {
    dumpJson: true,
    noCheckCertificates: true,
    noWarnings: true
  });
  
  const formats = result.formats;
  const videoFormats = formats.filter(f => f.vcodec !== 'none' && f.acodec !== 'none');
  const pureVideos = formats.filter(f => f.vcodec !== 'none');
  console.log("Video+Audio:");
  console.log(videoFormats.map(f => `${f.format_id} - ${f.format_note} (${f.ext})`));
  
  console.log("Audio only:");
  const audioFormats = formats.filter(f => f.vcodec === 'none' && f.acodec !== 'none');
  console.log(audioFormats.map(f => `${f.format_id} - ${f.format_note} (${f.ext} ${f.abr}k)`));
}
check().catch(console.error);
