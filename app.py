import os
import shutil
import numpy as np
from mutagen.flac import FLAC
from pydub import AudioSegment

# Define folders
current_folder = os.path.dirname(os.path.abspath(__file__))
unrenamed_folder = os.path.join(current_folder, "files")
# unrenamed_folder = r"C:\Users\pavit\Downloads\complete"
renamed_folder = os.path.join(current_folder, "renamed")
validated_folder = os.path.join(current_folder, "validated_folder")
recheck_folder = os.path.join(current_folder, "recheck_folder")
metadata_missing_folder = os.path.join(current_folder, "metadata_missing")
bitrate_invalid_folder = os.path.join(current_folder, "bitrate_invalid")

# Create folders if they don't exist
os.makedirs(unrenamed_folder, exist_ok=True)
os.makedirs(renamed_folder, exist_ok=True)
os.makedirs(validated_folder, exist_ok=True)
os.makedirs(recheck_folder, exist_ok=True)
os.makedirs(metadata_missing_folder, exist_ok=True)
os.makedirs(bitrate_invalid_folder, exist_ok=True)

# Function to sanitize file names for Windows
def sanitize_filename(filename):
    invalid_chars = '<>:"/\\|?*'
    sanitized = "".join(c if c not in invalid_chars else "_" for c in filename)
    return sanitized

# Function to read FLAC metadata
def read_flac_metadata(file_path):
    try:
        audio = FLAC(file_path)
        artist = audio.get("artist", [None])[0]
        title = audio.get("title", [None])[0]
        bitrate = audio.info.bitrate if hasattr(audio.info, 'bitrate') else None
        return artist, title, bitrate
    except Exception as e:
        print(f"Error reading metadata: {e}")
        return None, None, None

# Function to handle files based on metadata and bitrate
def process_flac_files(folder_path, target_folder):
    if not os.path.exists(target_folder):
        os.makedirs(target_folder)

    files = os.listdir(folder_path)
    for file_name in files:
        if file_name.endswith(".flac"):
            file_path = os.path.join(folder_path, file_name)
            artist, title, bitrate = read_flac_metadata(file_path)

            if bitrate is None or bitrate <= 0:
                print(f"{file_name}: Invalid bitrate, moving to bitrate_invalid folder.")
                shutil.move(file_path, os.path.join(bitrate_invalid_folder, file_name))
                continue

            if not artist or not title:
                print(f"{file_name}: Missing metadata, moving to metadata_missing folder.")
                shutil.move(file_path, os.path.join(metadata_missing_folder, file_name))
                continue

            sanitized_filename = sanitize_filename(f"{artist} - {title}.flac")
            new_file_path = os.path.join(target_folder, sanitized_filename)

            try:
                os.rename(file_path, new_file_path)
                print(f"File renamed to: {new_file_path}")
            except Exception as e:
                print(f"Error renaming file '{file_path}' to '{new_file_path}': {e}")

# Function to check for clipping in audio
def is_clipped(audio_segment):
    """Check if an audio segment has clipped samples."""
    samples = np.array(audio_segment.get_array_of_samples())
    max_amplitude = np.iinfo(samples.dtype).max
    min_amplitude = np.iinfo(samples.dtype).min
    return np.any(samples == max_amplitude) or np.any(samples == min_amplitude)

# Function to validate audio files
def validate_audio_files(input_folder):
    for file_name in os.listdir(input_folder):
        file_path = os.path.join(input_folder, file_name)

        # Skip the script file itself
        if file_name == os.path.basename(__file__):
            continue

        if not os.path.isfile(file_path):
            continue

        try:
            # Load audio
            audio = AudioSegment.from_file(file_path)

            if is_clipped(audio):
                print(f"{file_name}: Clipped audio detected.")
                shutil.move(file_path, os.path.join(recheck_folder, file_name))
            else:
                print(f"{file_name}: No clipping detected, moving to validated folder.")
                shutil.move(file_path, os.path.join(validated_folder, file_name))

        except Exception as e:
            print(f"Error processing {file_name}: {e}")
            shutil.move(file_path, os.path.join(recheck_folder, file_name))

# Main function to execute the entire pipeline
def main():
    # Step 1: Process FLAC files based on metadata and bitrate
    process_flac_files(unrenamed_folder, renamed_folder)

    # Step 2: Validate renamed files for audio clipping
    validate_audio_files(renamed_folder)

if __name__ == "__main__":
    main()
