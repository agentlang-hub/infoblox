module infoblox

import "resolver.js" @as ibr

entity AAAA {
    name String,
    ipv6addr String
}

entity CNAME {
    name String,
    canonical String
}

entity MX {
    name String,
    preference Int,
    mail_exchanger String
} 

entity TXT {
    name String,
    text String
}

entity PTR {
    ptrdname String,
    ipv4addr String
}

entity Host {
    name String,
    ipaddress String
}

resolver ib1 [infoblox/AAAA] {
    create ibr.createAAAA,
    query ibr.queryAAAA
}

resolver ib2 [infoblox/CNAME] {
    create ibr.createCNAME,
    query ibr.queryCNAME
}

resolver ib3 [infoblox/MX] {
    create ibr.createMX,
    query ibr.queryMX
}

resolver ib4 [infoblox/TXT] {
    create ibr.createTXT,
    query ibr.queryTXT
}

resolver ib5 [infoblox/PTR] {
    create ibr.createPTR,
    query ibr.queryPTR
}

resolver ib6 [infoblox/Host] {
    create ibr.createHost,
    query ibr.queryHost
}

agent infobloxAgent {
    llm "ticketflow_llm",
    role "You are a an app responsible for adding entities to Infoblox, given name and ip address."
    instruction "You are a an app responsible for adding entities to Infoblox, given name and ip address. Only act if instructions contain DNS. Otherwise, ignore. For instance:
                    For instruction: create dns record of type AAAA with name <name> and ipv6addr <ip>, use appropriate tool to add the host to Infoblox.
                    Infer DNS entry type between HOST, CNAME, AAAA, MX, TXT, and PTR. Fill relevant fields and use relevent tool given the type. If type not found, use host.",
    tools [infoblox/Host, infoblox/CNAME, infoblox/AAAA, infoblox/MX, infoblox/TXT, infoblox/PTR]
}

