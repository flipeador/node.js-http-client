# Node.js HTTP Client

Simple lightweight Node.js HTTP client.

- Supported url protocols: `http:` and `https:`.
- Supported [content encodings](https://developer.mozilla.org/docs/Web/HTTP/Headers/Content-Encoding): `gzip`, `deflate` and `br`.
- Supports automatic following for [URL forwarding](https://developer.mozilla.org/docs/Web/HTTP/Redirections).
- No dependencies.

HTTP test web server: <https://httpbin.org/>.

## Installation

```bash
npm install https://github.com/flipeador/node.js-http-client
```

## Examples

<details>
<summary><h5>GET Request.</h5></summary>

```js
const { Request } = require('@flipeador/node.js-http-client');

(async () => {
    const request = new Request('https://httpbin.org/get');
    const response = await request.send();
    console.log(response.json());
})();
```

</details>

<details>
<summary><h5>POST Request.</h5></summary>

```js
const { Request } = require('@flipeador/node.js-http-client');

(async () => {
    const request = new Request('https://httpbin.org/post')
        .setData('Hello World!', 'text/plain');
    const response = await request.send();
    console.log(response.json());
})();
```

</details>

<details>
<summary><h5>URL Forwarding.</h5></summary>

```js
const { Request } = require('@flipeador/node.js-http-client');

(async () => {
    const request = new Request('https://httpbin.org/redirect/1', {
        followRedirects: true
    }).setTimeout(5000);
    const response = await request.send();
    console.log(response.json());
})();
```

</details>

<details>
<summary><h5>Download a file.</h5></summary>

```js
const fs = require('node:fs');
const { Buffer } = require('node:buffer');
const { Request } = require('@flipeador/node.js-http-client');

(async () => {
    const stream = fs.createWriteStream('file.ext');
    let current = 0;

    const request = new Request('https://www.example.com/file.ext');

    await request.send((message, chunk) => {
        current += Buffer.byteLength(chunk);
        const total = message.response.headers['content-length'];
        if (total) {
            const percent = Math.round((current / total) * 100);
            console.log(`${current} of ${total} (${percent}%)`);
        } else
            console.log(`${current} bytes`);
        if (!stream.write(chunk))
            return new Promise(resolve => stream.once('drain', resolve));
    });

    stream.close(() => console.log('Done!'));
})();
```

</details>

<details>
<summary><h5>Data compression between client and server.</h5></summary>

```js
// client.js
const { Request } = require('@flipeador/node.js-http-client');

(async () => {
    const request = new Request('http://localhost:8080', {
        acceptEncoding: true
    }).setTimeout(1000);
    const response = await request.send();
    console.log(response.text());
})();
```

```js
// server.js
const http = require('node:http');
const { gzip } = require('@flipeador/node.js-http-client');

const server = http.createServer(async (request, response) => {
    console.log(request.method, request.headers);
    response.writeHead(200, {
        'content-encoding': 'gzip'
    });
    response.end(await gzip('Hello World'));
});

server.listen(8080, 'localhost', () => {
    console.log('Server is running!');
});
```

</details>

## License

This project is licensed under the **GNU General Public License v3.0**. See the [license file](LICENSE) for details.
