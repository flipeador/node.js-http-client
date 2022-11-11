# Node.js HTTP Client

Simple lightweight Node.js HTTP client.

- Supported url protocols: `http:` and `https:`.
- Supported [content encodings](https://developer.mozilla.org/docs/Web/HTTP/Headers/Content-Encoding): `gzip`, `deflate` and `br`.
- Supports automatic following for [URL forwarding](https://developer.mozilla.org/docs/Web/HTTP/Redirections).
- No dependencies.

HTTP test web server: <https://httpbin.org/>.

## Examples

<details>
<summary><h5>GET Request.</h5></summary>

```js
const { Request } = require('./request.js');

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
const { Request } = require('./request.js');

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
const { Request } = require('./request.js');

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
<summary><h5>Data compression between client and server.</h5></summary>

```js
// client.js
const { Request } = require('./request.js');

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
const { gzip } = require('./request.js');

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
