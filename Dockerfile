# Use an official Python runtime with Debian Bookworm
FROM python:3.11-slim-bookworm

# Set the working directory
WORKDIR /app

# Install Node.js, ffmpeg, and other dependencies
RUN apt-get update && apt-get install -y \
    curl \
    ffmpeg \
    git \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies (Whisper and yt-dlp)
RUN pip install --no-cache-dir -U openai-whisper yt-dlp
# Whisper requires a bit more setup: it needs git to be installed for some dependencies

# Copy package.json and package-lock.json first to leverage Docker cache
COPY package*.json ./

# Install Node.js dependencies
RUN npm ci --only=production

# Copy the rest of the application code
COPY . .

# Ensure working directories exist with correct permissions
RUN mkdir -p downloads uploads transcripts bootanim_work \
    && chmod -R 777 downloads uploads transcripts bootanim_work

# Expose the application port
EXPOSE 3000

# Set Node environment to production
ENV NODE_ENV=production

# Start the application
CMD ["node", "server.js"]
