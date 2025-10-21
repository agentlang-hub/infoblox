const al_integmanager = await import(`${process.cwd()}/node_modules/agentlang/out/runtime/integrations.js`)
const al_module = await import(`${process.cwd()}/node_modules/agentlang/out/runtime/module.js`)

const makeInstance = al_module.makeInstance

function getConfig(k) {
    return al_integmanager.getIntegrationConfig('infoblox', k)
}

const getResponseBody = async (response) => {
    try {
        try {
            return await response.json()
        } catch (e) {
            return await response.text();
        }
    } catch (error) {
        console.error("INFOBLOX RESOLVER: Error reading response body:", error);
        return {};
    }
}

// Generic HTTP functions
const makeRequest = async (endpoint, options = {}) => {
    const baseUrl = getConfig('baseUrl') || process.env.INFOBLOX_BASE_URL
    const user = getConfig('user') || process.env.INFOBLOX_USERNAME
    const password = getConfig('password') || process.env.INFOBLOX_PASSWORD
    const authHeader = 'Basic ' + btoa(`${user}:${password}`)
    
    const url = `${baseUrl}${endpoint}`;
    const defaultOptions = {
        headers: {
            'Content-Type': 'application/json',
            'Authorization': authHeader
        }
    };

    console.log(`INFOBLOX RESOLVER: making http request ${options.method} ${url} with options ${JSON.stringify(options)}`)

    const config = { ...defaultOptions, ...options };
    
    // Remove Content-Type header for GET requests without body
    if (config.method === 'GET') {
        delete config.headers['Content-Type'];
    }

    const timeoutMs = 30000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
        console.error(`INFOBLOX RESOLVER: Request timeout after ${timeoutMs}ms - ${url} - ${JSON.stringify(options)}`);
        controller.abort();
    }, timeoutMs);

    try {
            const response = await fetch(url, {
                ...config,
                signal: controller.signal
            });

            const body = await getResponseBody(response);
            console.log(`INFOBLOX RESOLVER: response ${response.status} ${response.ok}`, body)
        
        clearTimeout(timeoutId);

        if (response.status != 201 && response.status != 200) {
            if (body.code == 'Client.Ibap.Data.Conflict') {
                throw new Error(JSON.stringify(body));
            }
            throw new Error(`HTTP Error: ${JSON.stringify(response)}`);
        }    

        if (!response.ok) {
            console.error(`INFOBLOX RESOLVER: HTTP Error ${response.status} - ${url} - ${JSON.stringify(options)}`);
            throw error;
        }

        return body;

    } catch (error) {
        clearTimeout(timeoutId);
        
        if (error.name === 'AbortError') {
            console.error(`INFOBLOX RESOLVER: Request timeout - ${url} - ${JSON.stringify(options)}`);
        } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED' || error.code === 'EHOSTUNREACH') {
            console.error(`INFOBLOX RESOLVER: Network unreachable (${error.code}) - ${url} - ${JSON.stringify(options)}`);
        } else if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
            console.error(`INFOBLOX RESOLVER: Connection error (${error.code}) - ${url} - ${JSON.stringify(options)}`);
        } else {
            console.error(`INFOBLOX RESOLVER: Request failed (${error.name}) - ${url} - ${JSON.stringify(options)}`);
        }
        
        throw error;
    }
};

const makeGetRequest = async (endpoint) => {
    console.log(`INFOBLOX RESOLVER: Querying DNS Entries: ${endpoint}\n`);    
    return await makeRequest(endpoint, { method: 'GET' });
};

const makePostRequest = async (endpoint, body) => {
    console.log(`INFOBLOX RESOLVER: Creating a new DNS Entry: ${endpoint}\n`);

    return await makeRequest(endpoint, {
        method: 'POST',
        body: JSON.stringify(body)
    });
};

const makePatchRequest = async (endpoint, body) => {
    console.log(`INFOBLOX RESOLVER: Updating a DNS Entry: ${endpoint}\n`);
    const response = await makeRequest(endpoint, {
        method: 'PATCH',
        body: JSON.stringify(body)
    });

    if (response.status != 201 && response.status != 200) {
        throw new Error(`HTTP Error: ${JSON.stringify(response)}`);
    }

    return response;
};

const makeDeleteRequest = async (endpoint) => {
    console.log(`INFOBLOX RESOLVER: Deleting a DNS Entry: ${endpoint}\n`);
    return await makeRequest(endpoint, { method: 'DELETE' });
};

// Helper functions to convert API responses to instances
function toAAAA(record) {
    return {
        name: record.name,
        ipv6addr: record.ipv6addr,
        _ref: record._ref || record.id,
        created_at: record.created_at,
        updated_at: record.updated_at
    };
}

function toCNAME(record) {
    return {
        name: record.name,
        canonical: record.canonical,
        _ref: record._ref || record.id,
        created_at: record.created_at,
        updated_at: record.updated_at
    };
}

function toMX(record) {
    return {
        name: record.name,
        preference: record.preference,
        mail_exchanger: record.mail_exchanger,
        _ref: record._ref || record.id,
        created_at: record.created_at,
        updated_at: record.updated_at
    };
}

function toHost(record) {
    return {
        name: record.name,
        ipv4addr: record.ipv4addr,
        ipv6addr: record.ipv6addr,
        _ref: record._ref || record.id,
        created_at: record.created_at,
        updated_at: record.updated_at
    };
}

function toTXT(record) {
    return {
        name: record.name,
        text: record.text,
        _ref: record._ref || record.id,
        created_at: record.created_at,
        updated_at: record.updated_at
    };
}

function toPTR(record) {
    return {
        ptrdname: record.ptrdname,
        ipv4addr: record.ipv4addr,
        _ref: record._ref || record.id,
        created_at: record.created_at,
        updated_at: record.updated_at
    };
}

function toNetwork(network) {
    return {
        network: network.network,
        _ref: network._ref || network.id,
        created_at: network.created_at,
        updated_at: network.updated_at
    };
}

function asInstance(entity, entityType) {
    const instanceMap = new Map(Object.entries(entity));
    return makeInstance('infoblox', entityType, instanceMap);
}

// AAAA Record functions
export const createAAAA = async (env, attributes) => {
    const data = {
        name: attributes.attributes.get('name'),
        ipv6addr: attributes.attributes.get('ipv6addr')
    };

    try {
        const existingRecords = await makeGetRequest('/record:aaaa?name=' + data.name);
        let existingRecord; 
        
        if (typeof existingRecords === 'array') {
            existingRecord = existingRecords.find(record => 
                record.name === data.name && record.ipv6addr === data.ipv6addr
            );
        } else {
            existingRecord = existingRecords;
        }

        if (existingRecord && existingRecord._ref) {
            return {"result": "error", "code": "AlreadyExists"};
        }

        const result = await makePostRequest('/record:aaaa', data);
        return {"result": "success"};
    } catch (error) {
        console.error(`INFOBLOX RESOLVER: Failed to create AAAA record:`, error.message);
        try {
            const e = JSON.parse(error.message)
            
            // Check if it's a conflict error from the API
            if (e.code === 'Client.Ibap.Data.Conflict' || 
                (error.message && error.message.includes('ConflictError'))) {
                return {"result": "error", "code": "AlreadyExists"};
            }
        }
        catch (error) {
            return {"result": "error", "code": "other"};
        }
        
        return {"result": "error", "code": "other"};
    }
};

export const queryAAAA = async (env, attrs) => {
    const queryAttr = attrs.queryAttributes;
    const queryAttrVal = attrs.queryAttributeValues
    
    try {
        let endpoint = '/record:aaaa';
        
        if (queryAttr && queryAttrVal && queryAttr.size > 0) {
            const key = Array.from(queryAttr.keys())[0];
            const value = queryAttrVal.get(key);
            
            if (key === '__path__' && value.includes('infoblox$AAAA/')) {
                const ref = value.split('infoblox$AAAA/')[1];
                endpoint = `/record:aaaa/${ref}`;
            } else {
                endpoint = `/record:aaaa?${key}=${encodeURIComponent(value)}`;
            }
        }
        
        const result = await makeGetRequest(endpoint);
        const records = result.result || result;
        
        if (Array.isArray(records)) {
            return records.map(record => asInstance(toAAAA(record), 'AAAA'));
        } else {
            return [asInstance(toAAAA(records), 'AAAA')];
        }
    } catch (error) {
        console.error(`INFOBLOX RESOLVER: Failed to query AAAA records: ${error}`);
        return {"result": "error", "code": "other"};
    }
};

// CNAME Record functions
export const createCNAME = async (env, attributes) => {
    const data = {
        name: attributes.attributes.get('name'),
        canonical: attributes.attributes.get('canonical')
    };

    try {
        const existingRecords = await makeGetRequest('/record:cname?name=' + data.name);
        let existingRecord; 
        
        if (typeof existingRecords === 'array') {
            existingRecord = existingRecords.find(record => 
                record.name === data.name && record.canonical === data.canonical
            );
        } else {
            existingRecord = existingRecords;
        }

        if (existingRecord && existingRecord._ref) {
            return {"result": "error", "code": "AlreadyExists"};
        }

        const result = await makePostRequest('/record:cname', data);
        return {"result": "success"};
    } catch (error) {
        console.error(`INFOBLOX RESOLVER: Failed to create/update CNAME record:`, error.message);
        try {
            const e = JSON.parse(error.message)
            
            // Check if it's a conflict error from the API
            if (e.code === 'Client.Ibap.Data.Conflict' || 
                (error.message && error.message.includes('ConflictError'))) {
                return {"result": "error", "code": "AlreadyExists"};
            }
        }
        catch (error) {
            return {"result": "error", "code": "other"};
        }
        
        return {"result": "error", "code": "other"};
    }
};

export const queryCNAME = async (env, attrs) => {
    const queryAttr = attrs.queryAttributes;
    const queryAttrVal = attrs.queryAttributeValues
    
    try {
        let endpoint = '/record:cname';
        
        if (queryAttr && queryAttrVal && queryAttr.size > 0) {
            const key = Array.from(queryAttr.keys())[0];
            const value = queryAttrVal.get(key);
            
            if (key === '__path__' && value.includes('infoblox$CNAME/')) {
                const ref = value.split('infoblox$CNAME/')[1];
                endpoint = `/record:cname/${ref}`;
            } else {
                endpoint = `/record:cname?${key}=${encodeURIComponent(value)}`;
            }
        }
        
        const result = await makeGetRequest(endpoint);
        const records = result.result || result;
        
        if (Array.isArray(records)) {
            return records.map(record => asInstance(toCNAME(record), 'CNAME'));
        } else {
            return [asInstance(toCNAME(records), 'CNAME')];
        }
    } catch (error) {
        console.error(`INFOBLOX RESOLVER: Failed to query CNAME records: ${error}`);
        return {"result": "error", "code": "other"};
    }
};

// MX Record functions
export const createMX = async (env, attributes) => {
    const data = {
        name: attributes.attributes.get('name'),
        preference: parseInt(attributes.attributes.get('preference')),
        mail_exchanger: attributes.attributes.get('mail_exchanger')
    };

    try {
        const existingRecords = await makeGetRequest('/record:mx?name=' + data.name);
        let existingRecord; 
        
        if (typeof existingRecords === 'array') {
            existingRecord = existingRecords.find(record => 
                record.name === data.name && record.mail_exchanger === data.mail_exchanger && record.preference === data.preference
            );
        } else {
            existingRecord = existingRecords;
        }

        if (existingRecord && existingRecord._ref) {
            return {"result": "error", "code": "AlreadyExists"};
        }

        const result = await makePostRequest('/record:mx', data);
        return {"result": "success"};
    } catch (error) {
        console.error(`INFOBLOX RESOLVER: Failed to create MX record:`, error.message);
        try {
            const e = JSON.parse(error.message)
            
            // Check if it's a conflict error from the API
            if (e.code === 'Client.Ibap.Data.Conflict' || 
                (error.message && error.message.includes('ConflictError'))) {
                return {"result": "error", "code": "AlreadyExists"};
            }
        }
        catch (error) {
            return {"result": "error", "code": "other"};
        }
        
        return {"result": "error", "code": "other"};
    }
};

export const queryMX = async (env, attrs) => {
    const queryAttr = attrs.queryAttributes;
    const queryAttrVal = attrs.queryAttributeValues
    
    try {
        let endpoint = '/record:mx';
        
        if (queryAttr && queryAttrVal && queryAttr.size > 0) {
            const key = Array.from(queryAttr.keys())[0];
            const value = queryAttrVal.get(key);
            
            if (key === '__path__' && value.includes('infoblox$MX/')) {
                const ref = value.split('infoblox$MX/')[1];
                endpoint = `/record:mx/${ref}`;
            } else {
                endpoint = `/record:mx?${key}=${encodeURIComponent(value)}`;
            }
        }
        
        const result = await makeGetRequest(endpoint);
        const records = result.result || result;
        
        if (Array.isArray(records)) {
            return records.map(record => asInstance(toMX(record), 'MX'));
        } else {
            return [asInstance(toMX(records), 'MX')];
        }
    } catch (error) {
        console.error(`INFOBLOX RESOLVER: Failed to query MX records: ${error}`);
        return {"result": "error", "code": "other"};
    }
};

// HOST Record functions
export const createHost = async (env, attributes) => {
    const data = {
        name: attributes.attributes.get('name'),
        ipv4addr: attributes.attributes.get('ipv4addr'),
        ipv6addr: attributes.attributes.get('ipv6addr')
    };

    try {
        const existingRecords = await makeGetRequest('/record:host?name=' + data.name);
        let existingRecord; 
        
        if (typeof existingRecords === 'array') {
            existingRecord = existingRecords.find(record => 
                record.name === data.name && 
                ((data.ipv4addr && record.ipv4addr === data.ipv4addr) || (data.ipv6addr && record.ipv6addr === data.ipv6addr))
            );
        } else {
            existingRecord = existingRecords;
        }

        if (existingRecord && existingRecord._ref) {
            return {"result": "error", "code": "AlreadyExists"};
        }

        const result = await makePostRequest('/record:host', data);
        return {"result": "success"};
    } catch (error) {
        console.error(`INFOBLOX RESOLVER: Failed to create HOST record:`, error.message);
        try {
            const e = JSON.parse(error.message)
            
            // Check if it's a conflict error from the API
            if (e.code === 'Client.Ibap.Data.Conflict' || 
                (error.message && error.message.includes('ConflictError'))) {
                return {"result": "error", "code": "AlreadyExists"};
            }
        }
        catch (error) {
            return {"result": "error", "code": "other"};
        }
        
        return {"result": "error", "code": "other"};
    }
};

export const queryHost = async (env, attrs) => {
    const queryAttr = attrs.queryAttributes;
    const queryAttrVal = attrs.queryAttributeValues
    
    try {
        let endpoint = '/record:host';
        
        if (queryAttr && queryAttrVal && queryAttr.size > 0) {
            const key = Array.from(queryAttr.keys())[0];
            const value = queryAttrVal.get(key);
            
            if (key === '__path__' && value.includes('infoblox$Host/')) {
                const ref = value.split('infoblox$Host/')[1];
                endpoint = `/record:host/${ref}`;
            } else {
                endpoint = `/record:host?${key}=${encodeURIComponent(value)}`;
            }
        }
        
        const result = await makeGetRequest(endpoint);
        const records = result.result || result;
        
        if (Array.isArray(records)) {
            return records.map(record => asInstance(toHost(record), 'Host'));
        } else {
            return [asInstance(toHost(records), 'Host')];
        }
    } catch (error) {
        console.error(`INFOBLOX RESOLVER: Failed to query HOST records: ${error}`);
        return {"result": "error", "code": "other"};
    }
};

// TXT Record functions
export const createTXT = async (env, attributes) => {
    const data = {
        name: attributes.attributes.get('name'),
        text: attributes.attributes.get('text')
    };

    try {
        const existingRecords = await makeGetRequest('/record:txt?name=' + data.name);
        let existingRecord; 
        
        if (typeof existingRecords === 'array') {
            existingRecord = existingRecords.find(record => 
                record.name === data.name && record.text === data.text
            );
        } else {
            existingRecord = existingRecords;
        }

        if (existingRecord && existingRecord._ref) {
            return {"result": "error", "code": "AlreadyExists"};
        }

        await makePostRequest('/record:txt', data);
        return {"result": "success"};
    } catch (error) {
        console.error(`INFOBLOX RESOLVER: Failed to create TXT record:`, error.message);
        try {
            const e = JSON.parse(error.message)
            
            // Check if it's a conflict error from the API
            if (e.code === 'Client.Ibap.Data.Conflict' || 
                (error.message && error.message.includes('ConflictError'))) {
                return {"result": "error", "code": "AlreadyExists"};
            }
        }
        catch (error) {
            return {"result": "error", "code": "other"};
        }
        
        return {"result": "error", "code": "other"};
    }
};

export const queryTXT = async (env, attrs) => {
    const queryAttr = attrs.queryAttributes;
    const queryAttrVal = attrs.queryAttributeValues
    
    try {
        let endpoint = '/record:txt';
        
        if (queryAttr && queryAttrVal && queryAttr.size > 0) {
            const key = Array.from(queryAttr.keys())[0];
            const value = queryAttrVal.get(key);
            
            if (key === '__path__' && value.includes('infoblox$TXT/')) {
                const ref = value.split('infoblox$TXT/')[1];
                endpoint = `/record:txt/${ref}`;
            } else {
                endpoint = `/record:txt?${key}=${encodeURIComponent(value)}`;
            }
        }
        
        const result = await makeGetRequest(endpoint);
        const records = result.result || result;
        
        if (Array.isArray(records)) {
            return records.map(record => asInstance(toTXT(record), 'TXT'));
        } else {
            return [asInstance(toTXT(records), 'TXT')];
        }
    } catch (error) {
        console.error(`INFOBLOX RESOLVER: Failed to query TXT records: ${error}`);
        return {"result": "error", "code": "other"};
    }
};

// PTR Record functions
export const createPTR = async (env, attributes) => {
    const data = {
        ptrdname: attributes.attributes.get('ptrdname'),
        ipv4addr: attributes.attributes.get('ipv4addr')
    };

    try {
        const existingRecords = await makeGetRequest('/record:ptr?ptrdname=' + data.ptrdname);
        let existingRecord; 
        
        if (typeof existingRecords === 'array') {
            existingRecord = existingRecords.find(record => 
                record.ptrdname === data.ptrdname && record.ipv4addr === data.ipv4addr
            );
        } else {
            existingRecord = existingRecords;
        }

        if (existingRecord && existingRecord._ref) {
            return {"result": "error", "code": "AlreadyExists"};
        }

        const result = await makePostRequest('/record:ptr', data);
        return {"result": "success"};
    } catch (error) {
        console.error(`INFOBLOX RESOLVER: Failed to create PTR record:`, error.message);
        try {
            const e = JSON.parse(error.message)
            
            // Check if it's a conflict error from the API
            if (e.code === 'Client.Ibap.Data.Conflict' || 
                (error.message && error.message.includes('ConflictError'))) {
                return {"result": "error", "code": "AlreadyExists"};
            }
        }
        catch (error) {
            return {"result": "error", "code": "other"};
        }
        
        return {"result": "error", "code": "other"};
    }
};

export const queryPTR = async (env, attrs) => {
    const queryAttr = attrs.queryAttributes;
    const queryAttrVal = attrs.queryAttributeValues
    
    try {
        let endpoint = '/record:ptr';
        
        if (queryAttr && queryAttrVal && queryAttr.size > 0) {
            const key = Array.from(queryAttr.keys())[0];
            const value = queryAttrVal.get(key);
            
            if (key === '__path__' && value.includes('infoblox$PTR/')) {
                const ref = value.split('infoblox$PTR/')[1];
                endpoint = `/record:ptr/${ref}`;
            } else {
                endpoint = `/record:ptr?${key}=${encodeURIComponent(value)}`;
            }
        }
        
        const result = await makeGetRequest(endpoint);
        const records = result.result || result;
        
        if (Array.isArray(records)) {
            return records.map(record => asInstance(toPTR(record), 'PTR'));
        } else {
            return [asInstance(toPTR(records), 'PTR')];
        }
    } catch (error) {
        console.error(`INFOBLOX RESOLVER: Failed to query PTR records: ${error}`);
        return {"result": "error", "code": "other"};
    }
};

// Network functions
export const createNetwork = async (env, attributes) => {
    const data = {
        network: attributes.attributes.get('network')
    };

    try {
        const existingRecords = await makeGetRequest('/network?network=' + data.network);
        let existingRecord; 
        
        if (typeof existingRecords === 'array') {
            existingRecord = existingRecords.find(record => 
                record.network === data.network
            );
        } else {
            existingRecord = existingRecords;
        }

        if (existingRecord && existingRecord._ref) {
            return {"result": "error", "code": "AlreadyExists"};
        }

        const result = await makePostRequest('/network', data);
        return {
            "result": "success"
        };
    } catch (error) {
        console.error(`INFOBLOX RESOLVER: Failed to create network:`, error.message);
        try {
            const e = JSON.parse(error.message)
            
            // Check if it's a conflict error from the API
            if (e.code === 'Client.Ibap.Data.Conflict' || 
                (error.message && error.message.includes('ConflictError'))) {
                return {"result": "error", "code": "AlreadyExists"};
            }
        }
        catch (error) {
            return {"result": "error", "code": "other"};
        }
        
        return {"result": "error", "code": "other"};
    }
};

export const queryNetwork = async (env, attrs) => {
    const queryAttr = attrs.queryAttributes;
    const queryAttrVal = attrs.queryAttributeValues
    
    try {
        let endpoint = '/network';
        
        if (queryAttr && queryAttrVal && queryAttr.size > 0) {
            const key = Array.from(queryAttr.keys())[0];
            const value = queryAttrVal.get(key);
            
            if (key === '__path__' && value.includes('infoblox$Network/')) {
                const ref = value.split('infoblox$Network/')[1];
                endpoint = `/network/${ref}`;
            } else {
                endpoint = `/network?${key}=${encodeURIComponent(value)}`;
            }
        }
        
        const result = await makeGetRequest(endpoint);
        const networks = result.result || result;
        
        if (Array.isArray(networks)) {
            return networks.map(network => asInstance(toNetwork(network), 'Network'));
        } else {
            return [asInstance(toNetwork(networks), 'Network')];
        }
    } catch (error) {
        console.error(`INFOBLOX RESOLVER: Failed to query network: ${error}`);
        return {"result": "error", "code": "other"};
    }
};

// Delete functions
export const deleteAAAA = async (env, ref) => {
    try {
        await makeDeleteRequest(`/record:aaaa/${ref}`);
        return {"result": "success"};
    } catch (error) {
        console.error(`INFOBLOX RESOLVER: Failed to delete AAAA record:`, error.message);
        return {"result": "error", "code": "other"};
    }
};

export const deleteCNAME = async (env, attrs) => {
    const ref = attrs.attributes.get('_ref');
    try {
        await makeDeleteRequest(`/record:cname/${ref}`);
        return {"result": "success"};
    } catch (error) {
        console.error(`INFOBLOX RESOLVER: Failed to delete CNAME record:`, error.message);
        return {"result": "error", "code": "other"};
    }
};

export const deleteMX = async (env, attrs) => {
    const ref = attrs.attributes.get('_ref');
    try {
        await makeDeleteRequest(`/record:mx/${ref}`);
        return {"result": "success"};
    } catch (error) {
        console.error(`INFOBLOX RESOLVER: Failed to delete MX record:`, error.message);
        return {"result": "error", "code": "other"};
    }
};

export const deleteHost = async (env, attrs) => {
    const ref = attrs.attributes.get('_ref');
    try {
        await makeDeleteRequest(`/record:host/${ref}`);
        return {"result": "success"};
    } catch (error) {
        console.error(`INFOBLOX RESOLVER: Failed to delete HOST record:`, error.message);
        return {"result": "error", "code": "other"};
    }
};

export const deleteTXT = async (env, attrs) => {
    const ref = attrs.attributes.get('_ref');
    try {
        await makeDeleteRequest(`/record:txt/${ref}`);
        return {"result": "success"};
    } catch (error) {
        console.error(`INFOBLOX RESOLVER: Failed to delete TXT record:`, error.message);
        return {"result": "error", "code": "other"};
    }
};

export const deletePTR = async (env, attrs) => {
    const ref = attrs.attributes.get('_ref');
    try {
        await makeDeleteRequest(`/record:ptr/${ref}`);
        return {"result": "success"};
    } catch (error) {
        console.error(`INFOBLOX RESOLVER: Failed to delete PTR record:`, error.message);
        return {"result": "error", "code": "other"};
    }
};

export const deleteNetwork = async (env, attrs) => {
    const ref = attrs.attributes.get('_ref');
    try {
        await makeDeleteRequest(`/network/${ref}`);
        return {"result": "success"};
    } catch (error) {
        console.error(`INFOBLOX RESOLVER: Failed to delete network:`, error.message);
        return {"result": "error", "code": "other"};
    }
};

