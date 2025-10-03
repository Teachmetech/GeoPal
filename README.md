# GeoPal 🌍

A lightweight Node.js Express server that provides IP geolocation services using MaxMind's GeoLite2 databases. Features automatic IP detection, scheduled database updates via cron jobs, and Docker support.

## Features

- 🌐 **Automatic IP Detection** - No need to pass IP address, it's automatically detected
- 📍 **Comprehensive Geolocation Data** - City, country, region, coordinates, timezone, and more
- 🔄 **Automatic Database Updates** - Cron job downloads MaxMind databases on schedule (default: monthly)
- 🐳 **Dockerized** - Easy deployment with Docker and Docker Compose
- 🚀 **Lightweight** - Minimal dependencies, fast performance
- 📊 **Health Check Endpoint** - Monitor database status and last update time
- 🌐 **CORS Enabled** - Can be called from any origin (perfect for frontend apps)

## Quick Start

### Prerequisites

1. **Get a MaxMind License Key** (Free)
   - Sign up at [MaxMind GeoLite2](https://www.maxmind.com/en/geolite2/signup)
   - Generate a license key from your account

### Using Docker Compose (Recommended)

1. Clone the repository and navigate to the directory

2. Create a `.env` file:
   ```bash
   cp .env.example .env
   ```

3. Edit `.env` and add your MaxMind license key:
   ```env
   MAXMIND_LICENSE_KEY=your_license_key_here
   ```

4. Start the service:
   ```bash
   docker-compose up -d
   ```

5. Test the API:
   ```bash
   curl http://localhost:3000/api/location
   ```

### Using Docker

```bash
docker build -t geopal .
docker run -d -p 3000:3000 \
  -e MAXMIND_LICENSE_KEY=your_license_key_here \
  -v $(pwd)/data:/app/data \
  geopal
```

### Running Locally

1. Install dependencies:
   ```bash
   npm install
   ```

2. Set environment variables:
   ```bash
   export MAXMIND_LICENSE_KEY=your_license_key_here
   ```

3. Start the server:
   ```bash
   npm start
   ```

## API Endpoints

### `GET /api/location`

Returns geolocation information for the requesting IP address or a specified IP.

**Query Parameters:**
- `ip` (optional) - Specific IP address to look up. If not provided, automatically detects the requesting IP.

**Examples:**
```bash
# Auto-detect IP
curl http://localhost:3000/api/location

# Specify IP address
curl http://localhost:3000/api/location?ip=185.223.152.25
```

**Success Response:**
```json
{
  "status": "success",
  "query": "185.223.152.25",
  "country": "United States",
  "countryCode": "US",
  "region": "CA",
  "regionName": "California",
  "city": "Los Angeles",
  "zip": "90060",
  "lat": 34.0544,
  "lon": -118.244,
  "timezone": "America/Los_Angeles",
  "as": "AS396356 Latitude.sh",
  "isp": "Latitude.sh",
  "org": "IPXO"
}
```

**Error Responses:**

Invalid IP format:
```json
{
  "status": "fail",
  "message": "Invalid or missing IP address",
  "query": "not-an-ip"
}
```

Private/Local IP:
```json
{
  "status": "fail",
  "message": "Cannot geolocate private/local IP addresses",
  "query": "192.168.1.1",
  "note": "Private IP ranges (10.x, 192.168.x, 172.16-31.x) and localhost cannot be geolocated"
}
```

### `GET /health`

Health check endpoint showing database status.

**Response:**
```json
{
  "status": "ok",
  "databases": {
    "city": true,
    "asn": true
  },
  "lastUpdate": "2025-10-03T10:30:00.000Z"
}
```

### `GET /`

Returns API information and available endpoints.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MAXMIND_LICENSE_KEY` | - | MaxMind license key (required for database downloads) |
| `PORT` | `3000` | Server port |
| `CRON_SCHEDULE` | `0 0 1 * *` | Cron schedule for database updates (monthly by default) |

### Cron Schedule Examples

- `0 0 1 * *` - Monthly (1st of each month at midnight) - **Default**
- `0 0 * * 0` - Weekly (every Sunday at midnight)
- `0 0 */7 * *` - Every 7 days at midnight
- `0 2 * * *` - Daily at 2 AM

## Data Persistence

MaxMind databases are stored in the `./data` directory. When using Docker, this directory is mounted as a volume to persist databases across container restarts.

## MaxMind Databases

This service attempts to download and use the following GeoLite2 databases:

- **GeoLite2-City** - Provides city, country, region, coordinates, timezone, and postal code data
- **GeoLite2-ASN** - Provides ISP, organization, and ASN information

**Note:** Some free MaxMind accounts may have limited access to certain databases. If you see a 401 error for the ASN database, it means your license key doesn't have access to it. The service will still work with just the City database, but ISP/ASN information won't be available in the response.

## How It Works

1. **On Startup**: Downloads MaxMind GeoLite2 databases (City and ASN) if not present
2. **Scheduled Updates**: Cron job automatically downloads updated databases based on schedule
3. **IP Detection**: Automatically detects client IP from request headers (supports proxies)
4. **Lookup**: Queries MaxMind databases for geolocation information
5. **Response**: Returns formatted JSON with all available data

## IP Detection & Validation

### Automatic IP Detection

The server automatically detects the client's IP address by checking (in order):
1. `CF-Connecting-IP` header (Cloudflare Tunnel/Proxy)
2. `X-Forwarded-For` header (proxies/load balancers)
3. `X-Real-IP` header
4. Direct connection IP

Works seamlessly behind reverse proxies like Nginx, Cloudflare Tunnel, or load balancers.

### IP Validation

All IP addresses (auto-detected or provided via query parameter) are validated:

✅ **Accepted:**
- Valid IPv4 addresses (e.g., `8.8.8.8`)
- Valid IPv6 addresses (e.g., `2001:4860:4860::8888`)
- Public routable IP addresses

❌ **Rejected:**
- Invalid IP formats
- Private IP ranges (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`)
- Localhost addresses (`127.0.0.1`, `::1`)
- Link-local addresses (`169.254.0.0/16`, `fe80::/10`)
- ULA addresses (`fc00::/7`, `fd00::/8`)

## Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev
```

## License

MIT

## Acknowledgments

This service uses MaxMind's GeoLite2 databases, which are available for free with attribution.

