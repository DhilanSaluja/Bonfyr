const fs = require('fs');
const path = require('path');

const auth = JSON.parse(
  fs.readFileSync(path.join(process.env.USERPROFILE, '.expo', 'state.json'), 'utf8')
).auth;

const query = `
  query {
    account {
      byName(accountName: "dhilans") {
        pushSecurityEnabled
      }
    }
    app {
      byId(appId: "62d06051-0aa2-43d4-aa2a-a0c967239924") {
        fullName
      }
    }
  }
`;

async function main() {
  const res = await fetch('https://api.expo.dev/graphql', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'expo-session': auth.sessionSecret,
    },
    body: JSON.stringify({ query }),
  });
  const json = await res.json();
  console.log(
    JSON.stringify(
      {
        pushSecurityEnabled: json.data?.account?.byName?.pushSecurityEnabled ?? null,
        errors: json.errors?.map((e) => e.message) ?? null,
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
