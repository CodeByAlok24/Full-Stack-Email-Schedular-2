import { emailQueue } from "../queue/queue";

async function main(): Promise<void> {
  const id = process.argv[2];
  if (!id) {
    console.error("usage: npx tsx src/scripts/check-job.ts <jobId>");
    process.exit(1);
  }
  const job = await emailQueue.getJob(id);
  if (!job) {
    console.log(`job ${id} not found`);
    process.exit(1);
  }
  console.log(`job ${id} found`);
  console.log(`  name: ${job.name}`);
  console.log(`  data: ${JSON.stringify(job.data)}`);
  console.log(`  jobId: ${job.id}`);
  console.log(`  delay: ${job.delay}`);
  console.log(`  state: ${await job.getState()}`);
  console.log(`  attemptsMade: ${job.attemptsMade}`);
  await emailQueue.close();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
