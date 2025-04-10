---
title: Self Hosting
description: Getting started self hosting Ente Photos and/or Ente Auth
---

# Self Hosting

The entire source code for Ente is open source, including the servers. This is
the same code we use for our own cloud service.

> [!TIP]
>
> To get some context, you might find our
> [blog post](https://ente.io/blog/open-sourcing-our-server/) announcing the
> open sourcing of our server useful.

## Getting started - Quickstart

Install [Docker](https://www.docker.com). Then, paste the following command in a
your terminal:

```sh
sh -c "$(curl -fsSL https://raw.githubusercontent.com/ente-io/ente/main/server/quickstart.sh)"
```

> [!TIP]
>
> For more details about what this does, see [the quickstart
> README](https://github.com/ente-io/ente/blob/main/server/docs/quickstart.md).

That's about it. If you open http://localhost:3000 from the machine where the
server is running, you will be able to create an account on a Ente Photos web
app. This web app will be connecting to the server running on your local machine
at `localhost:8080`.

To complete your account registration you need to enter a 6-digit verification
code. These can be found in the server logs which should already be shown in
your quickstart terminal. Otherwise you can open the server logs with the
following command from inside the `my-ente` folder:

```sh
sudo docker compose logs
```

In the logs, find the code at the end of a message that resembles the following:
```sh
museum    | INFO[0102]email.go:130 sendViaTransmail Skipping sending email to email@example.com: *Verification code: 112089*
```

There are [prebuilt apps](https://ente.io/download) for iPad, iPhone, Android,
Linux, Mac, and Windows. These can easily be configured to use your [custom
self-hosted server](guides/custom-server/).

## Getting started - From source

The quickstart method above uses pre-built images. Alternatively, if you want to
build the self hosted server images from source, you can use the steps in this
section.

#### Installing Docker

Refer to
[How to install Docker from the APT repository](https://docs.docker.com/engine/install/ubuntu/#install-using-the-repository)
for detailed instructions.

#### Start the server

```sh
git clone https://github.com/ente-io/ente
cd ente/server
docker compose up --build
```

Install the necessary dependencies for running the web client

```sh
# installing npm and yarn

sudo apt update
sudo apt install nodejs npm
sudo npm install -g yarn // to install yarn globally
```

Then in a separate terminal, you can run (e.g) the web client

```sh
cd ente/web
yarn install
NEXT_PUBLIC_ENTE_ENDPOINT=http://localhost:8080 yarn dev
```

> If you want to build the mobile apps from source, see the instructions
> [here](guides/mobile-build).

## Next steps

- More details about the server are in its
  [README](https://github.com/ente-io/ente/tree/main/server#readme)

- More details about running the server (with or without Docker) are in
  [RUNNING](https://github.com/ente-io/ente/blob/main/server/RUNNING.md)

- If you have questions around self-hosting that are not answered in any of the
  existing documentation, you can ask in our
  [GitHub Discussions](https://github.com/ente-io/ente/discussions). **Please
  remember to search first if the query has been already asked and answered.**

## Contributing!

One particular way in which you can help is by adding new [guides](guides/) on
this help site. The documentation is written in Markdown and adding new pages is
[easy](https://github.com/ente-io/ente/tree/main/docs#readme). Editing existing
pages is even easier: at the bottom of each page is an _Edit this page_ link.
