FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy application files
COPY server.js ./

# Create data directory for MaxMind databases
RUN mkdir -p /app/data

# Expose port
EXPOSE 3000

# Environment variables (set these when running the container)
ENV PORT=3000
ENV CRON_SCHEDULE="0 0 1 * *"

# Start the application
CMD ["node", "server.js"]

