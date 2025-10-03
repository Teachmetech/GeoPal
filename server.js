const express = require('express');
const maxmind = require('maxmind');
const cron = require('node-cron');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const tar = require('tar');
const { promisify } = require('util');
const cors = require('cors');

const app = express();

// Enable CORS for all routes
// Allow any origin, only GET and OPTIONS
app.use(cors({
  origin: "*",
  methods: ["GET", "OPTIONS"],
}));

// Handle preflight requests explicitly
app.options("*", cors());
const PORT = process.env.PORT || 3000;
const MAXMIND_LICENSE_KEY = process.env.MAXMIND_LICENSE_KEY;
const CRON_SCHEDULE = process.env.CRON_SCHEDULE || '0 0 1 * *'; // Default: monthly (1st day of month at midnight)
const DATA_DIR = path.join(__dirname, 'data');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

let cityLookup = null;
let asnLookup = null;

// Database file paths
const CITY_DB_PATH = path.join(DATA_DIR, 'GeoLite2-City.mmdb');
const ASN_DB_PATH = path.join(DATA_DIR, 'GeoLite2-ASN.mmdb');

/**
 * Download and extract MaxMind database
 */
async function downloadDatabase(dbType) {
  if (!MAXMIND_LICENSE_KEY) {
    console.warn('⚠️  MAXMIND_LICENSE_KEY not set. Skipping database download.');
    console.warn('   Sign up at https://www.maxmind.com/en/geolite2/signup to get a free license key.');
    return false;
  }

  const url = `https://download.maxmind.com/app/geoip_download?edition_id=GeoLite2-${dbType}&license_key=${MAXMIND_LICENSE_KEY}&suffix=tar.gz`;
  const tarPath = path.join(DATA_DIR, `GeoLite2-${dbType}.tar.gz`);
  
  try {
    console.log(`📥 Downloading GeoLite2-${dbType} database...`);
    
    const response = await axios({
      method: 'get',
      url: url,
      responseType: 'stream'
    });

    const writer = fs.createWriteStream(tarPath);
    response.data.pipe(writer);

    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });

    console.log(`📦 Extracting GeoLite2-${dbType} database...`);
    
    // Extract tar.gz
    await tar.x({
      file: tarPath,
      cwd: DATA_DIR,
    });

    // Find the extracted .mmdb file and move it to the correct location
    const files = fs.readdirSync(DATA_DIR);
    const extractedDir = files.find(f => f.startsWith(`GeoLite2-${dbType}_`) && fs.statSync(path.join(DATA_DIR, f)).isDirectory());
    
    if (extractedDir) {
      const mmdbFile = path.join(DATA_DIR, extractedDir, `GeoLite2-${dbType}.mmdb`);
      const targetPath = path.join(DATA_DIR, `GeoLite2-${dbType}.mmdb`);
      
      if (fs.existsSync(mmdbFile)) {
        fs.copyFileSync(mmdbFile, targetPath);
        // Clean up extracted directory
        fs.rmSync(path.join(DATA_DIR, extractedDir), { recursive: true, force: true });
      }
    }

    // Clean up tar file
    fs.unlinkSync(tarPath);
    
    console.log(`✅ GeoLite2-${dbType} database updated successfully`);
    return true;
  } catch (error) {
    if (error.response?.status === 401) {
      console.warn(`⚠️  GeoLite2-${dbType} database not available with your license key`);
      console.warn(`   This database may require additional permissions or may not be included in your subscription`);
    } else {
      console.error(`❌ Error downloading GeoLite2-${dbType} database:`, error.message);
    }
    return false;
  }
}

/**
 * Initialize MaxMind databases
 */
async function initDatabases() {
  try {
    // Download databases if they don't exist
    if (!fs.existsSync(CITY_DB_PATH)) {
      await downloadDatabase('City');
    }
    if (!fs.existsSync(ASN_DB_PATH)) {
      await downloadDatabase('ASN');
    }

    // Open databases if files exist
    if (fs.existsSync(CITY_DB_PATH)) {
      cityLookup = await maxmind.open(CITY_DB_PATH);
      console.log('✅ GeoLite2-City database loaded');
    } else {
      console.warn('⚠️  GeoLite2-City database not found. IP lookup will be limited.');
    }

    if (fs.existsSync(ASN_DB_PATH)) {
      asnLookup = await maxmind.open(ASN_DB_PATH);
      console.log('✅ GeoLite2-ASN database loaded');
    } else {
      console.warn('⚠️  GeoLite2-ASN database not found. ASN lookup will be unavailable.');
    }
  } catch (error) {
    console.error('❌ Error initializing databases:', error.message);
  }
}

/**
 * Update all databases
 */
async function updateDatabases() {
  console.log('🔄 Starting scheduled database update...');
  
  const cityUpdated = await downloadDatabase('City');
  const asnUpdated = await downloadDatabase('ASN');

  // Reload databases if they were updated
  if (cityUpdated || asnUpdated) {
    await initDatabases();
  }
  
  console.log('✅ Database update completed');
}

/**
 * Extract client IP address from request
 */
function getClientIp(req) {
  // Check Cloudflare headers first (for Cloudflare Tunnel/Proxy)
  const cfConnectingIp = req.headers['cf-connecting-ip'];
  if (cfConnectingIp) {
    return cfConnectingIp;
  }
  
  // Check other common proxy headers
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  
  return req.headers['x-real-ip'] || 
         req.connection.remoteAddress || 
         req.socket.remoteAddress ||
         req.ip;
}

/**
 * Clean IPv6-mapped IPv4 addresses
 */
function cleanIp(ip) {
  if (ip && ip.startsWith('::ffff:')) {
    return ip.substring(7);
  }
  return ip;
}

/**
 * Validate IP address format
 */
function isValidIp(ip) {
  if (!ip || typeof ip !== 'string') {
    return false;
  }

  // IPv4 validation - more strict
  const ipv4Regex = /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
  
  // IPv6 validation - comprehensive
  const ipv6Regex = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;
  
  return ipv4Regex.test(ip) || ipv6Regex.test(ip);
}

/**
 * Check if IP is a private/local address
 */
function isPrivateIp(ip) {
  if (!ip) return false;
  
  // Localhost
  if (ip === '127.0.0.1' || ip === '::1' || ip === 'localhost') {
    return true;
  }
  
  // Private IPv4 ranges
  if (ip.startsWith('10.') || 
      ip.startsWith('192.168.') || 
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip)) {
    return true;
  }
  
  // Private IPv6 ranges
  if (ip.startsWith('fd') || ip.startsWith('fe80:') || ip.startsWith('fc')) {
    return true;
  }
  
  return false;
}

// API endpoint for geolocation
app.get('/api/location', (req, res) => {
  try {
    // Allow IP to be specified via query parameter, otherwise auto-detect
    let ip = req.query.ip || getClientIp(req);
    ip = cleanIp(ip);

    // Validate IP format
    if (!isValidIp(ip)) {
      return res.json({
        status: 'fail',
        message: 'Invalid or missing IP address',
        query: ip || 'none'
      });
    }

    // Check if it's a private/local IP
    if (isPrivateIp(ip)) {
      return res.json({
        status: 'fail',
        message: 'Cannot geolocate private/local IP addresses',
        query: ip,
        note: 'Private IP ranges (10.x, 192.168.x, 172.16-31.x) and localhost cannot be geolocated'
      });
    }

    const result = {
      status: 'success',
      query: ip
    };

    // Get city/country data
    if (cityLookup) {
      const cityData = cityLookup.get(ip);
      
      if (cityData) {
        result.country = cityData.country?.names?.en || '';
        result.countryCode = cityData.country?.iso_code || '';
        result.region = cityData.subdivisions?.[0]?.iso_code || '';
        result.regionName = cityData.subdivisions?.[0]?.names?.en || '';
        result.city = cityData.city?.names?.en || '';
        result.zip = cityData.postal?.code || '';
        result.lat = cityData.location?.latitude || 0;
        result.lon = cityData.location?.longitude || 0;
        result.timezone = cityData.location?.time_zone || '';
      }
    }

    // Get ASN data
    if (asnLookup) {
      const asnData = asnLookup.get(ip);
      
      if (asnData) {
        result.as = `AS${asnData.autonomous_system_number || ''} ${asnData.autonomous_system_organization || ''}`.trim();
        result.isp = asnData.autonomous_system_organization || '';
        result.org = asnData.autonomous_system_organization || '';
      }
    }

    // Check if databases are loaded
    if (!cityLookup && !asnLookup) {
      // No databases loaded at all
      return res.json({
        status: 'fail',
        query: ip,
        message: 'MaxMind databases not loaded. Please set MAXMIND_LICENSE_KEY environment variable.'
      });
    }

    // Check if we found any data
    if (!result.country && !result.as) {
      result.status = 'fail';
      result.message = 'No geolocation data found for this IP address';
    }

    res.json(result);
  } catch (error) {
    console.error('Error processing request:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
      error: error.message
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    databases: {
      city: cityLookup !== null,
      asn: asnLookup !== null
    },
    lastUpdate: fs.existsSync(CITY_DB_PATH) 
      ? fs.statSync(CITY_DB_PATH).mtime.toISOString()
      : null
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'GeoPal',
    description: 'Geolocation service using MaxMind databases',
    endpoints: {
      location: '/api/location',
      health: '/health'
    }
  });
});

// Initialize and start server
async function start() {
  console.log('🚀 Starting GeoPal server...');
  
  // Initialize databases
  await initDatabases();

  // Set up cron job for database updates
  console.log(`⏰ Scheduling database updates with cron: ${CRON_SCHEDULE}`);
  cron.schedule(CRON_SCHEDULE, updateDatabases);

  // Start server
  app.listen(PORT, () => {
    console.log(`\n✅ Server running on port ${PORT}`);
    console.log(`📍 Location API: http://localhost:${PORT}/api/location`);
    console.log(`🏥 Health check: http://localhost:${PORT}/health`);
    
    if (!MAXMIND_LICENSE_KEY) {
      console.log('\n⚠️  WARNING: MAXMIND_LICENSE_KEY not set!');
      console.log('   To enable full functionality:');
      console.log('   1. Sign up at https://www.maxmind.com/en/geolite2/signup');
      console.log('   2. Set MAXMIND_LICENSE_KEY environment variable');
    }
  });
}

start();

