FROM node:22-bookworm-slim

# Set Working Directory
WORKDIR /app

# Copy Package files
COPY package*.json ./

# Install Dependencies
RUN npm ci --omit=dev

# Copy Application Source
COPY . .

# Create Directories for Data & Uploads
RUN mkdir -p /app/data /app/public/uploads

# Set Environment Variables
ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/app/data

# Declare Persistent Volumes
VOLUME ["/app/data", "/app/public/uploads"]

# Expose Application Port
EXPOSE 3000

# Healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api/data').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

# Start Application
CMD ["node", "server.js"]
