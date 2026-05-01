// Run 'npx prisma db seed' in 'test/js/third_party/prisma/' to execute this

import { generateClient } from "./../../helper.ts";

const Client = await generateClient("postgres");
const prisma = new Client();

const createdUsers = await Promise.all(
  new Array(350).fill(0).map((_, i) =>
    prisma.users.create({
      data: {
        id: i,
        alive: ((Math.random() * 1e9) | 0) % 2 === 0,
      },
    }),
  ),
);
console.log(createdUsers.length);

await prisma.$disconnect();
