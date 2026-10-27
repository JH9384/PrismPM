import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import test from 'node:test';
import {assertCleanCheckout,packageTreeManifest,reconcile,replaceDependencyTransaction,updateDependencyRegister} from './reconcile-lexlean.mjs';

test('tree manifest closes package bytes including the crate archive',t=>{
 const root=mkdtempSync(join(tmpdir(),'reconcile-manifest-')); t.after(()=>rmSync(root,{recursive:true,force:true}));
 mkdirSync(join(root,'src')); writeFileSync(join(root,'src/lib.rs'),'x\n'); writeFileSync(join(root,'lexlean-0.4.0.crate'),'crate');
 const manifest=packageTreeManifest(root,'lexlean-0.4.0.crate');
 assert.match(manifest,/  lexlean-0\.4\.0\.crate\n/); assert.match(manifest,/  src\/lib\.rs\n/);
 const lines=manifest.trimEnd().split('\n'); assert.deepEqual(lines,[...lines].sort((a,b)=>Buffer.from(a.slice(66)).compare(Buffer.from(b.slice(66)))));
});

test('dependency update changes only the lexlean identity fields',()=>{
 const source='spec = "prismpm/dependencies/1"\n\n[[dependency]]\nid = "lexlean"\nversion = "0.4.0"\nrevision = "'+'1'.repeat(40)+'"\nsource = "vendored"\n\n[[dependency.artifact]]\nkind = "tree-manifest"\npath = "vendor/lexlean/MANIFEST.sha256"\nsha256 = "'+'2'.repeat(64)+'"\ntree_root = "vendor/lexlean"\n\n[[dependency.artifact]]\nkind = "file"\npath = "vendor/lexlean/lexlean-0.4.0.crate"\nsha256 = "'+'3'.repeat(64)+'"\n\n[[dependency]]\nid = "next"\nrevision = "'+'4'.repeat(40)+'"\n';
 const out=updateDependencyRegister(source,{revision:'a'.repeat(40),version:'0.4.0',manifestSha:'b'.repeat(64),crateSha:'c'.repeat(64)});
 assert.match(out,/revision = "a{40}"/); assert.match(out,/sha256 = "b{64}"/); assert.match(out,/sha256 = "c{64}"/); assert.match(out,/id = "next"/);
});

const selectedIdentity={revision:'a'.repeat(40),version:'0.4.0',manifestSha:'b'.repeat(64),crateSha:'c'.repeat(64)};
const selectedRegister='spec = "prismpm/dependencies/1"\n\n[[dependency]]\nid = "lexlean"\nversion = "0.4.0"\nrevision = "'+'a'.repeat(40)+'"\nsource = "vendored"\n\n[[dependency.artifact]]\nkind = "tree-manifest"\npath = "vendor/lexlean/MANIFEST.sha256"\nsha256 = "'+'b'.repeat(64)+'"\ntree_root = "vendor/lexlean"\n\n[[dependency.artifact]]\nkind = "file"\npath = "vendor/lexlean/lexlean-0.4.0.crate"\nsha256 = "'+'c'.repeat(64)+'"\n';

test('an earlier registered version moves to the selected version and crate path',()=>{
 const earlier=selectedRegister.replaceAll('0.4.0','0.3.0');
 const out=updateDependencyRegister(earlier,selectedIdentity);
 assert.equal(out,selectedRegister);
 assert.throws(()=>updateDependencyRegister(earlier.replace('lexlean-0.3.0.crate','lexlean-0.2.0.crate'),selectedIdentity));
});

test('already selected dependency is byte-identical on repeated reconciliation',()=>{
 assert.equal(updateDependencyRegister(selectedRegister,selectedIdentity),selectedRegister);
 const changed=updateDependencyRegister(selectedRegister,{...selectedIdentity,revision:'d'.repeat(40)});
 assert.notEqual(changed,selectedRegister);
 assert.equal(updateDependencyRegister(changed,{...selectedIdentity,revision:'d'.repeat(40)}),changed);
});

test('missing malformed and duplicated identities cannot become reconciliation no-ops',()=>{
 const mutations=[
  selectedRegister.replace(/^revision = .+\n/m,''),
  selectedRegister.replace('a'.repeat(40),'a'.repeat(39)),
  selectedRegister.replace('b'.repeat(64),'b'.repeat(63)),
  selectedRegister.replace('c'.repeat(64),'z'.repeat(64)),
  selectedRegister.replace('vendor/lexlean/MANIFEST.sha256','vendor/lexlean/other.sha256'),
  selectedRegister.replace('vendor/lexlean/lexlean-0.4.0.crate','vendor/lexlean/lexlean-0.4.1.crate'),
  selectedRegister.replace('revision = "'+'a'.repeat(40)+'"','revision = "'+'a'.repeat(40)+'"\nrevision = "'+'a'.repeat(40)+'"'),
  selectedRegister.replace('revision = "'+'a'.repeat(40)+'"','revision = "'+'a'.repeat(40)+'"\nrevision = "not-a-commit"'),
  selectedRegister.replace('version = "0.4.0"','version = "0.4.0"\nversion = "other"'),
  selectedRegister.replace('source = "vendored"','source = "vendored"\nsource = "other"'),
  selectedRegister.replace('id = "lexlean"','id = "lexlean"\nid = "other"'),
  selectedRegister.replace('sha256 = "'+'b'.repeat(64)+'"','sha256 = "'+'b'.repeat(64)+'"\nsha256 = "bad"'),
  selectedRegister.replace('sha256 = "'+'c'.repeat(64)+'"','sha256 = "'+'c'.repeat(64)+'"\n"sha256" = "bad"'),
  selectedRegister.replace('revision = "'+'a'.repeat(40)+'"','revision = "'+'a'.repeat(40)+'"\n"revi\\u0073ion" = "bad"'),
  selectedRegister+selectedRegister.slice(selectedRegister.indexOf('[[dependency]]')),
  selectedRegister+selectedRegister.slice(selectedRegister.indexOf('[[dependency.artifact]]')),
 ];
 for(const source of mutations) assert.throws(()=>updateDependencyRegister(source,selectedIdentity));
 assert.throws(()=>updateDependencyRegister(selectedRegister,{...selectedIdentity,version:'0.4.1'}));
});

// These subprocess fixtures qualify orchestration only. They never provide
// evidence that Cargo, LexLean, PrismPM or an SDK acceptance gate ran.
import {createHash} from 'node:crypto';
import {chmodSync,readFileSync,symlinkSync,lstatSync,existsSync,renameSync,linkSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const repository=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const helperSource=readFileSync(join(repository,'scripts/reconcile-lexlean.mjs'),'utf8');
const validationArgs=['run','--locked','--offline','-q','-p','xtask','--','validate'];

function validationFixture(t, source=helperSource, exitStatus=0) {
 const root=mkdtempSync(join(tmpdir(),'reconcile invocation '));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 mkdirSync(join(root,'scripts')); mkdirSync(join(root,'bin'));
 const helper=join(root,'scripts/reconcile-lexlean.mjs');
 writeFileSync(helper,source);
 const cargo=join(root,'bin/cargo');
 writeFileSync(cargo,`#!${process.execPath}\nconst fs=require('node:fs');\nconst args=process.argv.slice(2);\nfs.writeFileSync(process.env.INVOCATION_LOG,JSON.stringify({args,cwd:process.cwd()}));\nif(JSON.stringify(args)!==JSON.stringify(${JSON.stringify(validationArgs)})){process.stderr.write('unsupported xtask command\\n');process.exit(2);}\nprocess.exit(${exitStatus});\n`);
 chmodSync(cargo,0o755);
 const log=join(root,'invocation.json');
 const result=spawnSync(process.execPath,[helper,'--validate-generated'],{
  encoding:'utf8',cwd:tmpdir(),env:{...process.env,PATH:`${join(root,'bin')}:${process.env.PATH}`,INVOCATION_LOG:log},
 });
 return {root,result,invocation:JSON.parse(readFileSync(log,'utf8'))};
}

test('manifest contains actual file SHA-256, not a literal expression',t=>{
 const root=mkdtempSync(join(tmpdir(),'reconcile-digest-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 writeFileSync(join(root,'lexlean-0.4.0.crate'),'archive');
 assert.equal(packageTreeManifest(root,'lexlean-0.4.0.crate'),`${createHash('sha256').update('archive').digest('hex')}  lexlean-0.4.0.crate\n`);
});

test('manifest excludes only its root output and includes nested manifest source bytes',t=>{
 const root=mkdtempSync(join(tmpdir(),'reconcile-nested-manifest-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 mkdirSync(join(root,'src'));writeFileSync(join(root,'lexlean-0.4.0.crate'),'archive');
 writeFileSync(join(root,'MANIFEST.sha256'),'old generated root manifest');
 const nested=Buffer.from('ordinary upstream manifest source\n');writeFileSync(join(root,'src/MANIFEST.sha256'),nested);
 const expected=`${createHash('sha256').update('archive').digest('hex')}  lexlean-0.4.0.crate\n${createHash('sha256').update(nested).digest('hex')}  src/MANIFEST.sha256\n`;
 assert.equal(packageTreeManifest(root,'lexlean-0.4.0.crate'),expected);
 writeFileSync(join(root,'src/MANIFEST.sha256'),'changed nested source');
 assert.notEqual(packageTreeManifest(root,'lexlean-0.4.0.crate'),expected);
});

test('manifest rejects an absent archive or a symlink',t=>{
 const root=mkdtempSync(join(tmpdir(),'reconcile-manifest-negative-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 writeFileSync(join(root,'file'),'bytes');
 assert.throws(()=>packageTreeManifest(root,'lexlean-0.4.0.crate'),/archive is not in/);
 symlinkSync('file',join(root,'lexlean-0.4.0.crate'));
 assert.throws(()=>packageTreeManifest(root,'lexlean-0.4.0.crate'),/symlink/);
});

test('validation command exists in the real dispatcher and includes dependency auditing',()=>{
 const dispatcher=readFileSync(join(repository,'xtask/src/main.rs'),'utf8');
 assert.match(dispatcher,/"validate"\s*=>\s*validate_all\(&root, false\)/);
 assert.match(dispatcher,/fn validate_all\([\s\S]*?audit_all\(root\)/);
 assert.match(dispatcher,/fn audit_all\([\s\S]*?audit::audit_dependencies\(root\)\?/);
});

test('validation CLI actually invokes supported offline xtask in its repository',t=>{
 const {root,result,invocation}=validationFixture(t);
 assert.equal(result.status,0,result.stderr);
 assert.deepEqual(invocation,{args:validationArgs,cwd:root});
});

test('validation CLI propagates a real child-process failure',t=>{
 const {result,invocation}=validationFixture(t,helperSource,23);
 assert.notEqual(result.status,0);
 assert.match(result.stderr,/failed \(23\)/);
 assert.deepEqual(invocation.args,validationArgs);
});

test('unsupported-command mutation is rejected by the subprocess boundary',t=>{
 const old="'xtask','--','validate'";
 assert.ok(helperSource.includes(old));
 const mutation=helperSource.replace(old,"'xtask','--','audit-dependencies'");
 const {result}=validationFixture(t,mutation);
 assert.notEqual(result.status,0);
 assert.match(result.stderr,/unsupported xtask command/);
});

function assertLockedAcquisition(workflow){
 const start=workflow.indexOf('      - name: Acquire the separate exact locked Cargo inputs\n');
 const end=workflow.indexOf('      - name: Prepare the exact packaged dependency with its owning helper\n');
 assert.ok(start>=0 && end>start);
 const phase=workflow.slice(start,end);
 assert.ok(workflow.includes('CARGO_HOME: ${{ github.workspace }}/target/m0-locked-cargo-inputs'));
 assert.ok(phase.includes('test ! -e "$CARGO_HOME" && test ! -L "$CARGO_HOME"'));
 assert.ok(phase.includes('manifests=(Cargo.toml _m0/lexlean/Cargo.toml vendor/lexlean/Cargo.toml vendor/lean4-prod/rust/Cargo.toml stdlib/generated/package/Cargo.toml)'));
 assert.ok(phase.includes('CARGO_NET_OFFLINE=false cargo fetch --locked --manifest-path "$manifest"'));
 assert.equal((workflow.match(/CARGO_NET_OFFLINE=false/g)??[]).length,1);
 const generationStart=workflow.indexOf('      - name: Regenerate owned PrismPM evidence through the pinned devcontainer\n');
 const generationEnd=workflow.indexOf('      - name: Preserve an inert patch and its selected-source identity\n',generationStart);
 assert.ok(generationStart>=0 && generationEnd>generationStart);
 const generation=workflow.slice(generationStart,generationEnd);
 assert.ok(generation.includes('export CARGO_HOME="$PWD/target/m0-locked-cargo-inputs"'));
 assert.ok(generation.indexOf('export CARGO_NET_OFFLINE=true')>=0 && generation.indexOf('export CARGO_NET_OFFLINE=true')<generation.indexOf('just codegen'));
}

test('reconciliation workflow pins selected source and has no repository writer',()=>{
 const workflow=readFileSync(join(repository,'.github/workflows/m0-lexlean-reconcile.yml'),'utf8');
 const selected='e0b74b81e6f49c83596a957d232c8383a5db1a25';
 assert.match(workflow,/workflow_dispatch:/);
 assert.match(workflow,/branches: \[work\/compression-m0-reconcile\]/);
 assert.doesNotMatch(workflow,/pull_request_target:/);
 assert.equal((workflow.match(new RegExp(selected,'g'))??[]).length,3);
 assert.match(workflow,/permissions:\n  contents: read/);
 assert.equal((workflow.match(/persist-credentials: false/g)??[]).length,2);
 assert.doesNotMatch(workflow,/contents: write|packages: write|id-token: write|git (?:commit|push)|gh (?:pr|release)|cargo publish/);
 assert.match(workflow,/git diff --binary HEAD/);
 assert.match(workflow,/actions\/upload-artifact@[0-9a-f]{40}/);
 assert.equal((workflow.match(/if: always\(\)/g)??[]).length,2);
 assert.match(workflow,/name: m0-lexlean-reconciliation-proposal/);
 assert.match(workflow,/name: m0-lexlean-reconciliation-diagnostics/);
 assert.match(workflow,/partial-dependency\.json/);
 assert.ok(workflow.includes('(cd "$directory" && "$lexlean" lock && "$lexlean" clean)'));
 assert.match(workflow,/CARGO_NET_OFFLINE: "true"/);
 assertLockedAcquisition(workflow);
 for(const mutation of [
  workflow.replace('      - name: Acquire the separate exact locked Cargo inputs\n','      - name: Missing acquisition\n'),
  workflow.replace('cargo fetch --locked --manifest-path','cargo fetch --manifest-path'),
  workflow.replace('vendor/lean4-prod/rust/Cargo.toml stdlib/generated/package/Cargo.toml)','vendor/lean4-prod/rust/Cargo.toml)'),
  workflow.replace('export CARGO_HOME="$PWD/target/m0-locked-cargo-inputs"','export CARGO_HOME=/other-cache'),
  workflow.replace('CARGO_NET_OFFLINE=false cargo fetch','CARGO_NET_OFFLINE=true cargo fetch'),
  workflow.replace('export CARGO_NET_OFFLINE=true','export CARGO_NET_OFFLINE=false'),
 ]) assert.throws(()=>assertLockedAcquisition(mutation),assert.AssertionError);
 assert.match(workflow,/cargo build --locked --offline --manifest-path vendor\/lexlean\/Cargo\.toml/);
 assert.match(helperSource,/CARGO_NET_OFFLINE:'true'/);
 assert.equal((helperSource.match(/\['--offline','xtask',/g)??[]).length,3);
 assert.ok(helperSource.includes("['metadata','--offline','--format-version','1']"));
 assert.ok(helperSource.includes("['check','--workspace','--all-targets','--all-features','--locked','--offline']"));
 assert.match(workflow,/Diagnostic-only partial preparation/);
 const cloneIdentity=workflow.indexOf('test "$(git -C _m0/lexlean rev-parse HEAD)" = "$LEXLEAN_SOURCE_SHA"');
 assert.ok(cloneIdentity>=0 && cloneIdentity<workflow.indexOf('rm -rf _m0'));
 assert.ok(workflow.includes('test -z "$(git -C _m0/lexlean status --porcelain=v1 --untracked-files=all)"'));
 assert.ok(workflow.indexOf('--validate-generated')>workflow.indexOf('just package-release-crates-check'));
});

function assertReviewableGenerationBeforeCompleteAudit(workflow) {
 const names={"g":"      - name: Regenerate owned PrismPM evidence through the pinned devcontainer\n","p":"      - name: Preserve an inert patch and its selected-source identity\n","u":"      - name: Upload the reviewable preparation patch\n","v":"      - name: Run the complete generated-evidence audit through the pinned devcontainer\n","d":"      - name: Preserve preparation diagnostics even after failure\n"};
 const positions=Object.values(names).map(name=>{
  assert.equal(workflow.split(name).length,2);
  return workflow.indexOf(name);
 });
 assert(positions.every((position,index)=>index===0 || position>positions[index-1]));
 const [generation,preservation,upload,validation,diagnostics]=positions;
 assert.equal(workflow.slice(generation,preservation),"      - name: Regenerate owned PrismPM evidence through the pinned devcontainer\n        id: generated_prefix\n        uses: devcontainers/ci@513af61f4de4f75d37e4438f184ba4358f0fc1ca\n        with:\n          push: never\n          runCmd: |\n            set -euo pipefail\n            export CARGO_NET_OFFLINE=true\n            # Same acquired input cache, resolved inside this container's\n            # workspace. This is never a compiler/output or acceptance cache.\n            export CARGO_HOME=\"$PWD/target/m0-locked-cargo-inputs\"\n            mkdir -p target/m0-reconciliation-diagnostics\n            exec > target/m0-reconciliation-diagnostics/generation-step.log 2>&1\n            just codegen\n            just fixtures-write\n            just golden-write \"M0 issue #5: reconcile reviewed LexLean PR68 e0b74b81e6f49c83596a957d232c8383a5db1a25\"\n            just stdlib-package-write\n            stage=\"$(mktemp -d)\"\n            cp -a stdlib/generated/package \"$stage/stdlib\"\n            (\n              cd \"$stage/stdlib\"\n              CARGO_NET_OFFLINE=true cargo package --locked --offline --target-dir target\n            )\n            cp \"$stage/stdlib/target/package/prism-stdlib-0.2.0.crate\" \\\n              stdlib/generated/prism-stdlib-0.2.0.crate\n            crate_sha=\"$(sha256sum stdlib/generated/prism-stdlib-0.2.0.crate | cut -d' ' -f1)\"\n            semantic_id=\"$(python3 - <<'PY'\n            import json\n            print(json.load(open(\"tests/golden/stdlib/build/model.prism.json\"))[\"provenance\"][\"semantic_id\"])\n            PY\n            )\"\n            python3 - \"$crate_sha\" \"$semantic_id\" <<'PY'\n            import json, pathlib, sys\n            crate_sha, semantic_id = sys.argv[1:]\n            value = {\n                \"crate_path\": \"stdlib/generated/prism-stdlib-0.2.0.crate\",\n                \"crate_sha256\": crate_sha,\n                \"schema\": \"prismpm/stdlib-release/1\",\n                \"semantic_id\": semantic_id,\n            }\n            pathlib.Path(\"stdlib/release.json\").write_text(\n                json.dumps(value, separators=(\",\", \":\"), sort_keys=True)\n            )\n            PY\n            just golden-check\n            just stdlib-package-check\n            just check-fixtures\n            just package-release-crates-check\n            rm -r -- \"$stage\"\n\n");
 assert.equal(workflow.slice(validation,diagnostics),"      - name: Run the complete generated-evidence audit through the pinned devcontainer\n        # Fresh shared goldens must be reviewable before their native profiles\n        # can be regenerated. This audit remains mandatory and fail-closed;\n        # proposal preservation or upload cannot suppress it.\n        if: ${{ always() && !cancelled() && steps.generated_prefix.outcome == 'success' }}\n        uses: devcontainers/ci@513af61f4de4f75d37e4438f184ba4358f0fc1ca\n        with:\n          push: never\n          runCmd: |\n            set -euo pipefail\n            export CARGO_NET_OFFLINE=true\n            export CARGO_HOME=\"$PWD/target/m0-locked-cargo-inputs\"\n            mkdir -p target/m0-reconciliation-diagnostics\n            exec > target/m0-reconciliation-diagnostics/validation-step.log 2>&1\n            node scripts/reconcile-lexlean.mjs --validate-generated\n\n");
 const proposal=workflow.slice(preservation,validation);
 assert.equal(proposal,"      - name: Preserve an inert patch and its selected-source identity\n        shell: bash\n        run: |\n          set -euo pipefail\n          evidence=\"$RUNNER_TEMP/m0-reconciliation\"\n          mkdir -p \"$evidence\"\n          git diff --check\n          # Intent-to-add includes new generated files without committing them.\n          git add -N -- .\n          git diff --binary HEAD > \"$evidence/reconciliation.patch\"\n          # A fully revalidated, already-reconciled dependency may have no diff.\n          # Empty patches are preparation outcomes, never acceptance evidence.\n          git status --short > \"$evidence/worktree-status.txt\"\n          git rev-parse HEAD > \"$evidence/prismpm-source.txt\"\n          cp \"$RUNNER_TEMP/m0-reconcile.json\" \"$evidence/dependency.json\"\n          printf '%s\\n' \\\n            'Preparation only. Complete source and installed-SDK V&V, both platforms, security, reproducibility and publication remain required.' \\\n            > \"$evidence/UNACCEPTED.txt\"\n          sha256sum \"$evidence/reconciliation.patch\" > \"$evidence/SHA256SUMS\"\n      - name: Upload the reviewable preparation patch\n        uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02\n        with:\n          name: m0-lexlean-reconciliation-proposal\n          path: ${{ runner.temp }}/m0-reconciliation/\n          if-no-files-found: error\n          retention-days: 7\n\n");
 assert.match(proposal,/git diff --binary HEAD/);
 assert.match(proposal,/Preparation only\. Complete source and installed-SDK V&V, both platforms, security, reproducibility and publication remain required\./);
 assert.match(proposal,/> "\$evidence\/UNACCEPTED\.txt"/);
 assert.match(proposal,/if-no-files-found: error/);
 assert.doesNotMatch(workflow,/continue-on-error:|allow_failure|--skip|--exclude/);
 assert.equal(workflow.split('node scripts/reconcile-lexlean.mjs --validate-generated').length,2);
 assert.ok(workflow.includes('cp target/m0-reconciliation-diagnostics/validation-step.log "$diagnostics/"'));
 assertLockedAcquisition(workflow);
}

test('normal generation exports only an unaccepted proposal before the mandatory complete audit',()=>{
 const workflow=readFileSync(join(repository,'.github/workflows/m0-lexlean-reconcile.yml'),'utf8');
 assertReviewableGenerationBeforeCompleteAudit(workflow);
 const validation='            node scripts/reconcile-lexlean.mjs --validate-generated';
 const mutations=[
  workflow.replace('        id: generated_prefix\n',''),
  workflow.replace(validation,''),
  workflow.replace(validation,validation+' || true'),
  workflow.replace(validation,'            if false; then '+validation.trim()+'; fi'),
  workflow.replace("steps.generated_prefix.outcome == 'success'","steps.generated_prefix.outcome != 'failure'"),
  workflow.replace("always() && !cancelled() && steps.generated_prefix.outcome == 'success'","success()"),
  workflow.replace("steps.generated_prefix.outcome == 'success'","steps.generated_prefix.outcome == 'success' && steps.upload.outcome == 'success'"),
  workflow.replace('      - name: Run the complete generated-evidence audit','      - name: Missing complete generated-evidence audit'),
  workflow.replace('            just package-release-crates-check\n',''),
  workflow.replace('            just check-fixtures\n',''),
  workflow.replace('            just stdlib-package-check\n',''),
  workflow.replace('            just golden-check\n',''),
  workflow.replace('            rm -r -- "$stage"\n',''),
  workflow.replace('Preparation only. Complete source','Accepted. Complete source'),
  workflow.replace('if-no-files-found: error','if-no-files-found: ignore'),
  workflow.replace('      - name: Upload the reviewable preparation patch\n','      - name: Missing proposal upload\n'),
  workflow.replace('        id: generated_prefix\n','        id: generated_prefix\n        continue-on-error: true\n'),
  workflow.replace('cp target/m0-reconciliation-diagnostics/validation-step.log "$diagnostics/"','true'),
  workflow.replace('      - name: Preserve an inert patch and its selected-source identity\n','      - name: Preserve an inert patch and its selected-source identity\n        if: false\n'),
  workflow.replace('      - name: Upload the reviewable preparation patch\n','      - name: Upload the reviewable preparation patch\n        if: false\n'),
  workflow.replace('actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02','actions/upload-artifact@main'),
  workflow.replace('path: ${{ runner.temp }}/m0-reconciliation/','path: ${{ runner.temp }}/wrong-proposal/'),
  workflow.replace('git diff --binary HEAD > "$evidence/reconciliation.patch"','git diff --binary HEAD > "$evidence/reconciliation.patch" || true'),
 ];
 const validationStart=workflow.indexOf('      - name: Run the complete generated-evidence audit');
 for(const [before,after] of [
  ['devcontainers/ci@513af61f4de4f75d37e4438f184ba4358f0fc1ca','devcontainers/ci@main'],
  ['export CARGO_NET_OFFLINE=true','export CARGO_NET_OFFLINE=false'],
  ['export CARGO_HOME="$PWD/target/m0-locked-cargo-inputs"','export CARGO_HOME=/other-cache'],
  ['set -euo pipefail','set +e'],
 ]) mutations.push(workflow.slice(0,validationStart)+workflow.slice(validationStart).replace(before,after));
 const proposalStart=workflow.indexOf('      - name: Preserve an inert patch and its selected-source identity');
 const diagnosticsStart=workflow.indexOf('      - name: Preserve preparation diagnostics even after failure');
 mutations.push(workflow.slice(0,proposalStart)+workflow.slice(validationStart,diagnosticsStart)+workflow.slice(proposalStart,validationStart)+workflow.slice(diagnosticsStart));
 for(const mutation of mutations) {
  assert.notEqual(mutation,workflow);
  assert.throws(()=>assertReviewableGenerationBeforeCompleteAudit(mutation),assert.AssertionError);
 }
});

function assertCompleteRelocking(workflow) {
 const start=workflow.indexOf('      - name: Update the root dependency lock and every real LexLean consumer\n');
 const end=workflow.indexOf('      - name: Regenerate owned PrismPM evidence through the pinned devcontainer\n',start);
 assert(start>=0 && end>start);
 assert.equal(workflow.slice(start,end), String.raw`      - name: Update the root dependency lock and every real LexLean consumer
        shell: bash
        run: |
          set -euo pipefail
          export RUSTUP_TOOLCHAIN=1.97.1
          mkdir -p "$RUNNER_TEMP/m0-reconciliation-diagnostics"
          exec > "$RUNNER_TEMP/m0-reconciliation-diagnostics/relock-step.log" 2>&1
          target="$RUNNER_TEMP/vendor-lexlean-target"
          CARGO_TARGET_DIR="$target" cargo build --locked --offline --manifest-path vendor/lexlean/Cargo.toml --bin lexlean
          lexlean="$target/debug/lexlean"
          while IFS= read -r config; do
            directory="$(dirname "$config")"
            test -f "$directory/lexlean.lock" || continue
            echo "relocking $directory"
            # Normal lock authoring creates a build-root lock file. Retire that
            # temporary root through the same compiler before fixture readers.
            (cd "$directory" && "$lexlean" lock && "$lexlean" clean)
          done < <(find . \
            -path './vendor' -prune -o \
            -path './target' -prune -o \
            -name lexlean.toml -type f -print | sort)

`);
}

test('every locked consumer including the checksum-mutation baseline is normally relocked',()=>{
 const workflow=readFileSync(join(repository,'.github/workflows/m0-lexlean-reconcile.yml'),'utf8');
 assertCompleteRelocking(workflow);
 const mutations=[
  workflow.replace('echo "relocking $directory"', 'if test "$directory" = "./tests/negative/lock/stale/project"; then continue; fi\n            echo "relocking $directory"'),
  workflow.replace('test -f "$directory/lexlean.lock" || continue', 'continue'),
  workflow.replace('cargo build --locked --offline --manifest-path', 'cargo build --manifest-path'),
  workflow.replace('"$lexlean" lock && "$lexlean" clean', '"$lexlean" lock'),
  workflow.replace('"$lexlean" lock && "$lexlean" clean', '"$lexlean" lock && "$lexlean" clean || true'),
  workflow.replace('"$lexlean" lock && "$lexlean" clean', '"$lexlean" lock --check && "$lexlean" clean'),
  workflow.replace('-name lexlean.toml -type f -print | sort)', '-name lexlean.toml -type f -print | head -n 1)'),
  workflow.replace('(cd "$directory" && "$lexlean" lock && "$lexlean" clean)', 'if false; then (cd "$directory" && "$lexlean" lock && "$lexlean" clean); fi'),
  workflow.replace("            -path './vendor'", "            # split the continued find command\n            -path './vendor'"),
  workflow.replace("            -path './vendor'", "\n            -path './vendor'"),
  workflow.replace('          done < <(find .', '        done < <(find .'),
 ];
 for(const mutation of mutations) {
  assert.notEqual(mutation,workflow);
  assert.throws(()=>assertCompleteRelocking(mutation),assert.AssertionError);
 }
});

test('real offline Cargo metadata refuses a fresh empty input cache before any build',t=>{
 const root=mkdtempSync(join(tmpdir(),'reconcile-empty-cargo-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const cache=join(root,'cargo');mkdirSync(cache);
 const result=spawnSync('cargo',['metadata','--locked','--offline','--format-version','1','--manifest-path',join(repository,'Cargo.toml')],{
  cwd:repository,env:{...process.env,CARGO_HOME:cache,CARGO_NET_OFFLINE:'true'},encoding:'utf8',timeout:30000,maxBuffer:1024*1024,
 });
 assert.equal(result.error,undefined);assert.equal(result.signal,null);assert.equal(result.status,101);
 assert.match(result.stderr,/no matching package named/);assert.match(result.stderr,/offline mode/);
});


test('owning package boundary rejects untracked and tracked source, allowing ignored outputs',t=>{
 const root=mkdtempSync(join(tmpdir(),'reconcile-clean-source-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const git=(...args)=>{
  const result=spawnSync('git',args,{cwd:root,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);return result.stdout.trim();
 };
 git('init','--quiet');
 writeFileSync(join(root,'.gitignore'),'build-output/\n');
 writeFileSync(join(root,'source.lex.tex'),'source\n');
 git('add','.gitignore','source.lex.tex');
 git('-c','user.name=Reconciliation test fixture','-c','user.email=fixture@example.invalid','commit','--quiet','-m','fixture source');
 const revision=git('rev-parse','HEAD');
 mkdirSync(join(root,'build-output'));writeFileSync(join(root,'build-output/result'),'ignored build output');
 assert.doesNotThrow(()=>assertCleanCheckout(root,revision));
 writeFileSync(join(root,'untracked.lex.tex'),'untracked source\n');
 // Run the actual preparation entry point: it must reject before invoking Cargo.
 assert.throws(()=>reconcile(root,root,revision),/LexLean source is dirty/);
 rmSync(join(root,'untracked.lex.tex'));
 writeFileSync(join(root,'source.lex.tex'),'changed source\n');
 assert.throws(()=>reconcile(root,root,revision),/LexLean source is dirty/);
});

function transactionFixture(t){
 const root=mkdtempSync(join(tmpdir(),'reconcile-transaction-'));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 mkdirSync(join(root,'vendor/lexlean'),{recursive:true});mkdirSync(join(root,'model'));
 writeFileSync(join(root,'vendor/lexlean/original'),'original vendor');
 writeFileSync(join(root,'model/dependencies.toml'),'original register');writeFileSync(join(root,'Cargo.lock'),'original lock');
 const prepare=stage=>{writeFileSync(join(stage,'replacement'),'new vendor');return 'new register';};
 const original=()=>{
  assert.equal(readFileSync(join(root,'vendor/lexlean/original'),'utf8'),'original vendor');
  assert.equal(readFileSync(join(root,'model/dependencies.toml'),'utf8'),'original register');
  assert.equal(readFileSync(join(root,'Cargo.lock'),'utf8'),'original lock');
  assert.equal(existsSync(join(root,'vendor/.lexlean-reconcile-stage')),false);
  assert.equal(existsSync(join(root,'vendor/.lexlean-reconcile-backup')),false);
 };
 return {root,prepare,original};
}

test('transaction retains prior vendor register and Cargo lock on actual dependency-write failure',t=>{
 const {root,prepare,original}=transactionFixture(t);let denial;
 assert.throws(()=>replaceDependencyTransaction(root,prepare,()=>assert.fail('validation after failed write'),(path,value)=>{
  chmodSync(path,0o444);
  try {writeFileSync(path,value);assert.fail('read-only dependency file unexpectedly writable');}
  catch(error){denial=error;throw error;}
  finally {chmodSync(path,0o644);}
 }),error=>error===denial&&error.code==='EACCES');
 original();
});

test('transaction restores all prior bytes after real metadata and check child failures',t=>{
 for(const phase of ['metadata','check']){
  const {root,prepare,original}=transactionFixture(t);const observed=[];
  assert.throws(()=>replaceDependencyTransaction(root,prepare,()=>{
   assert.equal(readFileSync(join(root,'vendor/lexlean/replacement'),'utf8'),'new vendor');
   assert.equal(readFileSync(join(root,'vendor/.lexlean-reconcile-backup/original'),'utf8'),'original vendor');
   assert.equal(readFileSync(join(root,'model/dependencies.toml'),'utf8'),'new register');
   writeFileSync(join(root,'Cargo.lock'),'resolved lock');
   for(const name of ['metadata','check']){
    const child=spawnSync(process.execPath,['-e',`process.exit(${name===phase?23:0})`],{encoding:'utf8'});observed.push(name);
    assert.equal(child.signal,null);if(child.status!==0)throw new Error(`${name} actual child failed (${child.status})`);
   }
  }),new RegExp(`${phase} actual child failed \\(23\\)`));
  assert.deepEqual(observed,phase==='metadata'?['metadata']:['metadata','check']);original();
 }
});

test('transaction removes only its own partial preparation and preserves preexisting foreign paths',t=>{
 const {root,original}=transactionFixture(t);
 assert.throws(()=>replaceDependencyTransaction(root,stage=>{writeFileSync(join(stage,'partial'),'partial');throw new Error('preparation failed');},()=>assert.fail()),/preparation failed/);original();
 for(const name of ['.lexlean-reconcile-stage','.lexlean-reconcile-backup'])for(const kind of ['directory','file','dangling']){
  const path=join(root,'vendor',name);
  if(kind==='directory')mkdirSync(path);else if(kind==='file')writeFileSync(path,'foreign');else symlinkSync('missing',path);
  const before=lstatSync(path,{bigint:true});
  assert.throws(()=>replaceDependencyTransaction(root,()=>assert.fail('prepare entered'),()=>assert.fail()),/prior reconciliation/);
  const after=lstatSync(path,{bigint:true});assert.equal(after.ino,before.ino);assert.equal(after.mode,before.mode);
  rmSync(path,{recursive:true});original();
 }
});

test('transaction refuses rollback over a foreign path and retains its primary failure and backup',t=>{
 const {root,prepare}=transactionFixture(t);const failure=new Error('validation failed');
 assert.throws(()=>replaceDependencyTransaction(root,prepare,()=>{
  mkdirSync(join(root,'vendor/.lexlean-reconcile-stage'));writeFileSync(join(root,'vendor/.lexlean-reconcile-stage/foreign'),'foreign');throw failure;
 }),error=>error instanceof AggregateError&&error.cause===failure);
 assert.equal(readFileSync(join(root,'vendor/.lexlean-reconcile-stage/foreign'),'utf8'),'foreign');
 assert.equal(readFileSync(join(root,'vendor/.lexlean-reconcile-backup/original'),'utf8'),'original vendor');
});

test('transaction commits only after validation and removes its retired backup',t=>{
 const {root,prepare}=transactionFixture(t);
 assert.equal(replaceDependencyTransaction(root,prepare,()=>{writeFileSync(join(root,'Cargo.lock'),'resolved lock');return 'validated';}),'validated');
 assert.equal(readFileSync(join(root,'vendor/lexlean/replacement'),'utf8'),'new vendor');
 assert.equal(readFileSync(join(root,'model/dependencies.toml'),'utf8'),'new register');
 assert.equal(readFileSync(join(root,'Cargo.lock'),'utf8'),'resolved lock');
 assert.equal(existsSync(join(root,'vendor/.lexlean-reconcile-stage')),false);assert.equal(existsSync(join(root,'vendor/.lexlean-reconcile-backup')),false);
});

test('transaction refuses aliased parents and nonregular or shared inputs before staging',t=>{
 for(const parent of ['vendor','model','vendor/lexlean']){
  const {root}=transactionFixture(t),path=join(root,parent),saved=path+'-original';renameSync(path,saved);symlinkSync(saved,path);
  assert.throws(()=>replaceDependencyTransaction(root,()=>assert.fail('prepare entered'),()=>assert.fail()),/not an owned directory/);
  assert.equal(readFileSync(join(root,'vendor/lexlean/original'),'utf8'),'original vendor');
  assert.equal(readFileSync(join(root,'model/dependencies.toml'),'utf8'),'original register');
  assert.equal(existsSync(join(root,'vendor/.lexlean-reconcile-stage')),false);
 }
 {
  const {root,original}=transactionFixture(t),alias=join(root,'alias');symlinkSync(root,alias);
  assert.throws(()=>replaceDependencyTransaction(alias,()=>assert.fail('prepare entered'),()=>assert.fail()),/not an owned directory/);original();
 }
 for(const input of ['model/dependencies.toml','Cargo.lock'])for(const kind of ['symlink','hardlink','directory']){
  const {root}=transactionFixture(t),path=join(root,input),saved=path+'-original';const bytes=readFileSync(path);
  if(kind==='hardlink')linkSync(path,saved);else{renameSync(path,saved);if(kind==='symlink')symlinkSync(saved,path);else mkdirSync(path);}
  assert.throws(()=>replaceDependencyTransaction(root,()=>assert.fail('prepare entered'),()=>assert.fail()),/not a private regular input/);
  assert.deepEqual(readFileSync(saved),bytes);assert.equal(readFileSync(join(root,'vendor/lexlean/original'),'utf8'),'original vendor');
  assert.equal(existsSync(join(root,'vendor/.lexlean-reconcile-stage')),false);
 }
});
