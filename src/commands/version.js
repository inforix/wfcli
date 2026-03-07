export function registerVersionCommands(program, version, writer = process.stdout) {
  program
    .command("version")
    .description("Show wfcli version")
    .action(() => {
      writer.write(`${version}\n`);
    });
}
