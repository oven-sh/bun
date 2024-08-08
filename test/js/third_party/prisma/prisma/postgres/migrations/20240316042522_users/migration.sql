-- CreateTable
CREATE TABLE "Users" (
    "id" SERIAL NOT NULL,
    "alive" BOOLEAN NOT NULL,

    CONSTRAINT "Users_pkey" PRIMARY KEY ("id")
);
