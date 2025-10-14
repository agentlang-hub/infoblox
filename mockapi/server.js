const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet());
app.use(cors());
app.use(morgan('combined'));
app.use(express.json());

// Basic Authentication middleware
const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  
  const credentials = Buffer.from(authHeader.split(' ')[1], 'base64').toString();
  const [username, password] = credentials.split(':');
  
  if (username !== 'admin' || password !== 'infoblox') {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  
  next();
};

// In-memory storage
let networks = [];
let dnsRecords = {
  host: [],
  aaaa: [],
  cname: [],
  mx: [],
  txt: [],
  ptr: []
};

// Helper function to generate unique ID
const generateId = () => Math.random().toString(36).substr(2, 9);

// Helper function to validate IP addresses
const isValidIPv4 = (ip) => {
  const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (!ipv4Regex.test(ip)) return false;
  const parts = ip.split('.');
  return parts.every(part => parseInt(part) >= 0 && parseInt(part) <= 255);
};

const isValidIPv6 = (ip) => {
  const ipv6Regex = /^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/;
  return ipv6Regex.test(ip);
};

// Helper function to validate domain names
const isValidDomain = (domain) => {
  const domainRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  return domainRegex.test(domain);
};

// Helper function to validate CIDR notation
const isValidCIDR = (cidr) => {
  const cidrRegex = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/;
  if (!cidrRegex.test(cidr)) return false;
  const [ip, prefix] = cidr.split('/');
  return isValidIPv4(ip) && parseInt(prefix) >= 0 && parseInt(prefix) <= 32;
};

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// WAPI v2.13.1 routes
const wapiBase = '/wapi/v2.13.1';

// Network management
app.get(`${wapiBase}/network`, authenticate, (req, res) => {
  res.json({ result: networks });
});

app.post(`${wapiBase}/network`, authenticate, (req, res) => {
  const { network } = req.body;
  
  if (!network || !isValidCIDR(network)) {
    return res.status(400).json({ error: 'Valid network CIDR is required' });
  }
  
  // Check if network already exists
  const existingNetwork = networks.find(n => n.network === network);
  if (existingNetwork) {
    return res.status(400).json({
      "Error": `AdmConDataError: IB.Data.ConflictError: This network already exists (network: ${network})`,
      "code": "Client.Ibap.Data.Conflict",
      "text": `This network already exists (network: ${network})`
    });
  }
  
  const newNetwork = {
    id: generateId(),
    network,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  
  networks.push(newNetwork);
  
  res.status(201).json(newNetwork);
});

app.get(`${wapiBase}/network/:id`, authenticate, (req, res) => {
  const { id } = req.params;
  const network = networks.find(n => n.id === id);
  
  if (!network) {
    return res.status(404).json({ error: 'Network not found' });
  }
  
  res.json(network);
});

const urlHost = '/wapi/v2.13.1/record\\:host'
const urlAaaa = '/wapi/v2.13.1/record\\:aaaa'
const urlCname = '/wapi/v2.13.1/record\\:cname'
const urlMx = '/wapi/v2.13.1/record\\:mx'
const urlTxt = '/wapi/v2.13.1/record\\:txt'
const urlPtr = '/wapi/v2.13.1/record\\:ptr'

// DNS Record management - Host records
app.get(urlHost, authenticate, (req, res) => {
  res.json({ result: dnsRecords.host });
});

app.post(urlHost, authenticate, (req, res) => {
  const { name, ipv4addr, ipv6addr } = req.body;
  
  if (!name || (!ipv4addr && !ipv6addr)) {
    return res.status(400).json({ error: 'Host records require name and either ipv4addr or ipv6addr' });
  }
  
  if (!isValidDomain(name)) {
    return res.status(400).json({ error: 'Invalid domain name' });
  }
  
  if (ipv4addr && !isValidIPv4(ipv4addr)) {
    return res.status(400).json({ error: 'Invalid IPv4 address' });
  }
  
  if (ipv6addr && !isValidIPv6(ipv6addr)) {
    return res.status(400).json({ error: 'Invalid IPv6 address' });
  }
  
  // Check if host record already exists
  const existingRecord = dnsRecords.host.find(record => 
    record.name === name && 
    ((ipv4addr && record.ipv4addr === ipv4addr) || (ipv6addr && record.ipv6addr === ipv6addr))
  );
  if (existingRecord) {
    const recordType = ipv4addr ? 'A' : 'AAAA';
    return res.status(400).json({
      "Error": `AdmConDataError: IB.Data.ConflictError: This record already exists (record name: ${name}, type: ${recordType})`,
      "code": "Client.Ibap.Data.Conflict",
      "text": `This record already exists (record name: ${name}, type: ${recordType})`
    });
  }
  
  const newRecord = {
    id: generateId(),
    name,
    ipv4addr: ipv4addr || null,
    ipv6addr: ipv6addr || null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  
  dnsRecords.host.push(newRecord);
  
  res.status(201).json(newRecord);
});

// DNS Record management - AAAA records
app.get(urlAaaa, authenticate, (req, res) => {
  res.json({ result: dnsRecords.aaaa });
});

app.post(urlAaaa, authenticate, (req, res) => {
  const { name, ipv6addr } = req.body;

  if (!name || !ipv6addr) {
    return res.status(400).json({ error: 'AAAA records require both name and ipv6addr' });
  }
  
  if (!isValidDomain(name)) {
    return res.status(400).json({ error: 'Invalid domain name' });
  }
  
  if (!isValidIPv6(ipv6addr)) {
    return res.status(400).json({ error: 'Invalid IPv6 address' });
  }
  
  // Check if AAAA record already exists
  const existingRecord = dnsRecords.aaaa.find(record => 
    record.name === name && record.ipv6addr === ipv6addr
  );
  if (existingRecord) {
    return res.status(400).json({
      "Error": `AdmConDataError: IB.Data.ConflictError: This record already exists (record name: ${name}, type: AAAA)`,
      "code": "Client.Ibap.Data.Conflict",
      "text": `This record already exists (record name: ${name}, type: AAAA)`
    });
  }
  
  const newRecord = {
    id: generateId(),
    name,
    ipv6addr,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  
  dnsRecords.aaaa.push(newRecord);
  
  res.status(201).json(newRecord);
});

// DNS Record management - CNAME records
app.get(urlCname, authenticate, (req, res) => {
  res.json({ result: dnsRecords.cname });
});

app.post(urlCname, authenticate, (req, res) => {
  const { name, canonical } = req.body;
  
  if (!name || !canonical) {
    return res.status(400).json({ error: 'CNAME records require both name and canonical' });
  }
  
  if (!isValidDomain(name) || !isValidDomain(canonical)) {
    return res.status(400).json({ error: 'Invalid domain name' });
  }
  
  // Check if CNAME record already exists
  const existingRecord = dnsRecords.cname.find(record => 
    record.name === name && record.canonical === canonical
  );
  if (existingRecord) {
    return res.status(400).json({
      "Error": `AdmConDataError: IB.Data.ConflictError: This record already exists (record name: ${name}, type: CNAME)`,
      "code": "Client.Ibap.Data.Conflict",
      "text": `This record already exists (record name: ${name}, type: CNAME)`
    });
  }
  
  const newRecord = {
    id: generateId(),
    name,
    canonical,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  
  dnsRecords.cname.push(newRecord);
  
  res.status(201).json(newRecord);
});

// DNS Record management - MX records
app.get(urlMx, authenticate, (req, res) => {
  res.json({ result: dnsRecords.mx });
});

app.post(urlMx, authenticate, (req, res) => {
  const { name, preference, mail_exchanger } = req.body;
  
  if (!name || preference === undefined || !mail_exchanger) {
    return res.status(400).json({ error: 'MX records require name, preference, and mail_exchanger' });
  }
  
  if (!isValidDomain(name) || !isValidDomain(mail_exchanger)) {
    return res.status(400).json({ error: 'Invalid domain name' });
  }
  
  if (typeof preference !== 'number' || preference < 0) {
    return res.status(400).json({ error: 'Preference must be a non-negative number' });
  }
  
  // Check if MX record already exists
  const existingRecord = dnsRecords.mx.find(record => 
    record.name === name && record.mail_exchanger === mail_exchanger && record.preference === preference
  );
  if (existingRecord) {
    return res.status(400).json({
      "Error": `AdmConDataError: IB.Data.ConflictError: This record already exists (record name: ${name}, type: MX)`,
      "code": "Client.Ibap.Data.Conflict",
      "text": `This record already exists (record name: ${name}, type: MX)`
    });
  }
  
  const newRecord = {
    id: generateId(),
    name,
    preference,
    mail_exchanger,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  
  dnsRecords.mx.push(newRecord);
  
  res.status(201).json(newRecord);
});

// DNS Record management - TXT records
app.get(urlTxt, authenticate, (req, res) => {
  res.json({ result: dnsRecords.txt });
});

app.post(urlTxt, authenticate, (req, res) => {
  const { name, text } = req.body;
  
  if (!name || !text) {
    return res.status(400).json({ error: 'TXT records require both name and text' });
  }
  
  if (!isValidDomain(name)) {
    return res.status(400).json({ error: 'Invalid domain name' });
  }
  
  // Check if TXT record already exists
  const existingRecord = dnsRecords.txt.find(record => 
    record.name === name && record.text === text
  );
  if (existingRecord) {
    return res.status(400).json({
      "Error": `AdmConDataError: IB.Data.ConflictError: This record already exists (record name: ${name}, type: TXT)`,
      "code": "Client.Ibap.Data.Conflict",
      "text": `This record already exists (record name: ${name}, type: TXT)`
    });
  }
  
  const newRecord = {
    id: generateId(),
    name,
    text,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  
  dnsRecords.txt.push(newRecord);
  
  res.status(201).json(newRecord);
});

// DNS Record management - PTR records
app.get(urlPtr, authenticate, (req, res) => {
  res.json({ result: dnsRecords.ptr });
});

app.post(urlPtr, authenticate, (req, res) => {
  const { ptrdname, ipv4addr } = req.body;
  
  if (!ptrdname || !ipv4addr) {
    return res.status(400).json({ error: 'PTR records require both ptrdname and ipv4addr' });
  }
  
  if (!isValidDomain(ptrdname)) {
    return res.status(400).json({ error: 'Invalid domain name' });
  }
  
  if (!isValidIPv4(ipv4addr)) {
    return res.status(400).json({ error: 'Invalid IPv4 address' });
  }
  
  const newRecord = {
    id: generateId(),
    ptrdname,
    ipv4addr,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  
  dnsRecords.ptr.push(newRecord);
  
  res.status(201).json(newRecord);
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Start server
app.listen(PORT, () => {
  console.log(`Infoblox Mock Server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`WAPI endpoint: http://localhost:${PORT}/wapi/v2.13.1`);
});

module.exports = app;
