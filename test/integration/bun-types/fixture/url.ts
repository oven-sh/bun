const myUrl = new URL("hello");
myUrl.searchParams.toJSON();

const mySearchParams = new URLSearchParams("hello");
mySearchParams.toJSON();

import { URL as NodeURL, URLSearchParams as NodeURLSearchParams } from "node:url";

const nodeUrl = new NodeURL("hello");
nodeUrl.searchParams.toJSON();

const nodeSearchParams = new NodeURLSearchParams("hello");
nodeSearchParams.toJSON();

import { URL as UrlURL, URLSearchParams as UrlURLSearchParams } from "url";

const urlUrl = new UrlURL("hello");
urlUrl.searchParams.toJSON();

const urlSearchParams = new UrlURLSearchParams("hello");
urlSearchParams.toJSON();
