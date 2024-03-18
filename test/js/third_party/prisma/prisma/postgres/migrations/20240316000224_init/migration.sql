-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "testId" INTEGER NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Post" (
    "id" SERIAL NOT NULL,
    "testId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "authorId" INTEGER NOT NULL,
    "option1" INTEGER,
    "option2" INTEGER,
    "option3" INTEGER,
    "option4" INTEGER,
    "option5" INTEGER,
    "option6" INTEGER,
    "option7" INTEGER,
    "option8" INTEGER,
    "option9" INTEGER,
    "option10" INTEGER,
    "option11" INTEGER,
    "option12" INTEGER,
    "option13" INTEGER,
    "option14" INTEGER,
    "option15" INTEGER,
    "option16" INTEGER,
    "option17" INTEGER,
    "option18" INTEGER,
    "option19" INTEGER,
    "option20" INTEGER,
    "option21" INTEGER,
    "option22" INTEGER,
    "option23" INTEGER,
    "option24" INTEGER,
    "option25" INTEGER,

    CONSTRAINT "Post_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
