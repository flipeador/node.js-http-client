'use strict';

const util = require('node:util');
const zlib = require('node:zlib');
const http = require('node:http');
const https = require('node:https');
const { Buffer } = require('node:buffer');
const { URL, URLSearchParams } = require('node:url');

const gzip = util.promisify(zlib.gzip);
const gunzip = util.promisify(zlib.gunzip);
const deflate = util.promisify(zlib.deflate);
const inflate = util.promisify(zlib.inflate);
const brotliCompress = util.promisify(zlib.brotliCompress);
const brotliDecompress = util.promisify(zlib.brotliDecompress);

class RequestError extends Error {
    constructor(message, ...args) {
        if (typeof(message) === 'object')
            super(util.format(args.shift(), ...args.map(x => util.inspect(x))), message);
        else super(util.format(message, ...args.map(x => util.inspect(x))));
    }

    static wrap(cause, message, ...args) {
        if (cause instanceof this) return cause;
        return new this({ cause }, message, ...args);
    }
}

class RequestTimeout extends RequestError {
    constructor(timeout) {
        super('Request timed out after %s ms', timeout);
    }
}

class RequestAborted extends RequestError {
    constructor(data) {
        super('The connection was terminated while the message was still being sent');
        Object.assign(this, data ?? {});
    }
}

class RequestStatus extends RequestError {
    constructor(code) {
        super(http.STATUS_CODES[code] ?? `Error #${code}`);
        this.code = code;
    }
}

/**
 * Decompress a chunk of data.
 * @param {Buffer} chunk Chunk of data.
 * @param {String[]?} encodings Compression: `gzip` | `deflate` | `br`.
 * @reference https://developer.mozilla.org/docs/Web/HTTP/Headers/Content-Encoding
 */
async function decompress(chunk, encodings)
{
    for (const method of encodings ?? [])
    {
        switch (method.trim())
        {
            case 'gzip':
                chunk = await gunzip(chunk);
                break;
            case 'deflate':
                chunk = await inflate(chunk);
                break;
            case 'br':
                chunk = await brotliDecompress(chunk);
                break;
        }
    }
    return chunk;
}

function parseMessageContent(data, type)
{
    let _type = type ? `${type}`.toLowerCase()
        : Buffer.isBuffer(data) ? 'buffer'
        : typeof(data) === 'string' ? 'text' : 'json';

    _type = {
        buffer: 'application/octet-stream',
        json: 'application/json',
        form: 'application/x-www-form-urlencoded',
        text: 'text/plain'
    }[_type] ?? _type;

    if (!Buffer.isBuffer(data))
    {
        if (typeof(data) !== 'string')
            data = JSON.stringify(data);
        else if (!type && _type === 'application/x-www-form-urlencoded')
            data = (new URLSearchParams(data)).toString();
    }

    return { data, type: _type, size: Buffer.byteLength(data) };
}

class ContentType
{
    _mimeType = '';
    _params = { };

    constructor(content)
    {
        if (content)
        {
            for (const part of `${content}`.toLowerCase().split(';'))
            {
                const subpart = part.split('=');
                if (subpart.length === 1)
                    this._mimeType = subpart[0].trim();
                else if (subpart.length === 2)
                    this._params[subpart[0].trim()] = subpart[1].trim();
            }
        }
    }

    getMimeType()
    {
        return this._mimeType;
    }

    setMimeType(type)
    {
        this._mimeType = `${type}`.toLowerCase();
        return this;
    }

    getParam(name, defval)
    {
        return this._params[`${name}`.toLowerCase()] ?? defval;
    }

    setParam(name, value)
    {
        this._params[`${name}`.toLowerCase()] = `${value}`;
        return this;
    }

    toString()
    {
        let content = this._mimeType;
        for (const param in this._params)
            content += `;${param}=${this._params[param]}`;
        return content;
    }
}

class Message
{
    /**
     * Create a Message object.
     * @param {http.IncomingMessage} response The incoming message.
     */
    constructor(response)
    {
        this.response = response;
        this.contentType = new ContentType(response.headers['content-type']);
        this.charset = this.contentType.getParam('charset', 'utf-8');
        this.content = Buffer.alloc(0, undefined, this.charset);
        this.encoding = response.headers['content-encoding'];
        this.encodings = this.encoding ? this.encoding.split(',').reverse() : [];
    }

    /**
     * Concat a chunk of data to the message content.
     */
    concat(chunk)
    {
        this.content = Buffer.concat([this.content, chunk]);
        return this;
    }

    /**
     * Get the status code.
     */
    status()
    {
        return this.response.statusCode;
    }

    /**
     * Check if the client's request was successfully received, understood, and accepted.
     */
    success()
    {
        return this.status() >= 200 && this.status() < 300;
    }

    /**
     * Check if further action needs to be taken by the user agent in order to fulfill the request.
     */
    redirection()
    {
        return this.response.headers.hasOwnProperty('location')
            && (this.status() === 201 || (this.status() >= 300 && this.status() < 400));
    }

    /**
     * Get the message content as plain text.
     */
    text()
    {
        return this.content.toString();
    }

    /**
     * Get the message content as json formatted text.
     */
    json()
    {
        return JSON.parse(this.text());
    }

    /**
     * Get a string representation of the message content.
     */
    toString()
    {
        return this.text();
    }
}

class Request
{
    options = { headers: { } };

    /**
     * Create a Request object.
     * @param {String|URL} url Request URL.
     * @param {Object} options Options.
     * @param {String} options.method Request method. Defaults to `GET`.
     * @param {Number} options.timeout Request timeout, in milliseconds.
     * @param {Boolean} options.followRedirects Whether to allow URL forwarding.
     * @param {Boolean} options.acceptEncoding Whether compressed data is accepted.
     * @param {Number} options.chunkSize Number of bytes to read when receiving data.
     */
    constructor(url, options)
    {
        this.url = url instanceof URL ? url : new URL(url);
        this.followRedirects = !!options?.followRedirects;
        this.chunkSize = options?.chunkSize;
        if (options?.acceptEncoding)
            this.setHeader('accept-encoding', 'gzip, deflate, br');
        this.setTimeout(options?.timeout);
        this.setOption('method', options?.method);
    }

    /**
     * Set the request timeout.
     * @param {Number?} timeout Timeout, in milliseconds.
     */
    setTimeout(timeout)
    {
        if (timeout !== undefined)
            this.timeout = parseInt(timeout ?? 0);
        return this;
    }

    /**
     * Set a request option.
     * @reference https://nodejs.org/api/http.html#httprequesturl-options-callback
     */
    setOption(name, value)
    {
        if (typeof(name) === 'string')
            this.options[name] = value;
        else for (const key in name)
            this.options[`${key}`] = name[key];
        return this;
    }

    /**
     * Append a new name-value pair to the url query string.
     * @reference https://developer.mozilla.org/docs/Web/API/URLSearchParams/append
     */
    setQuery(name, value)
    {
        if (typeof(name) === 'string')
            this.url.searchParams.append(name, `${value}`);
        else for (const key in name)
            this.url.searchParams.append(`${key}`, `${name[key]}`);
        return this;
    }

    /**
     * Set a name-value pair to the request headers.
     * @reference https://developer.mozilla.org/docs/Web/HTTP/Headers
     */
    setHeader(header, value)
    {
        if (typeof(header) === 'string')
            this.options.headers[header.toLowerCase()] = value;
        else for (const key in header)
            this.options.headers[`${key}`.toLowerCase()] = header[key];
        return this;
    }

    /**
     * Set the message content.
     * @param data The data to be sent.
     * @param {String?} type The type of data, e.g. `application/json`.
     * @remarks The request method is set to `POST` if it is not already set.
     */
    setData(data, type)
    {
        this.content = parseMessageContent(data, type);
        this.setHeader('content-type', this.content.type);
        this.setHeader('content-length', this.content.size);
        this.options.method ??= 'POST';
        return this;
    }

    /**
     * Send the request to the web server.
     * @param {Function?} callback Incoming data handler.
     * @return {Promise<Message>} Returns a {@link Message} object.
     */
    async send(callback)
    {
        try {
            return await new Promise((resolve, reject) => {
                this.options.method ??= 'GET';
                this.options.path = `${this.url.pathname}${this.url.search}`;

                /**
                 * @param {http.IncomingMessage} response
                 */
                const _callback = async (response) => {
                    const message = new Message(response);

                    response.once('error', error => {
                        message.invalid = !reject(error);
                    });

                    if (this.followRedirects && message.redirection()) {
                        try {
                            this.url = new URL(response.headers.location, this.url);
                            return response.destroy(resolve(await this.send()));
                        } catch (error) {
                            return response.destroy(error);
                        }
                    }

                    if (!message.success())
                        return response.destroy(new RequestStatus(message.status()));

                    let promise = Promise.resolve();

                    response.on('readable', () => {
                        promise = promise.then(async () => {
                            let chunk;
                            while (!message.invalid && (chunk = response.read(this.chunkSize))) {
                                if (callback) await callback.call(this, message, chunk);
                                else message.concat(await decompress(chunk, message.encodings));
                            }
                        }).catch(error => response.destroy(error));
                    });

                    response.once('end', () => {
                        message.invalid ??= !response.complete;
                        if (message.invalid)
                            reject(new RequestAborted({ message }));
                        else promise.then(() => resolve(message));
                    });
                };

                let request;
                if (this.url.protocol === 'http:')
                    request = http.request(this.url, this.options, _callback);
                else if (this.url.protocol === 'https:')
                    request = https.request(this.url, this.options, _callback);
                else throw new RequestError('Invalid URL protocol: %s', this.url.protocol);

                request.once('error', reject);

                if (this.timeout) request.setTimeout(this.timeout, () => {
                    reject(new RequestTimeout(this.timeout));
                    request.destroy();
                });

                request.end(this.content?.data);
            });
        } catch (error) {
            throw RequestError.wrap(error, '%s', this);
        }
    }
}

module.exports = {
    URL,
    URLSearchParams,

    gzip,
    gunzip,
    deflate,
    inflate,
    brotliCompress,
    brotliDecompress,

    RequestError,
    RequestTimeout,
    RequestAborted,
    RequestStatus,

    decompress,
    parseMessageContent,

    ContentType,
    Message,
    Request
};
