<?php
// Operator bootstrap only. No token is printed or sent to GitHub.
require '/var/www/html/vendor/autoload.php';
$app = require '/var/www/html/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

$input = json_decode(stream_get_contents(STDIN), true, 16, JSON_THROW_ON_ERROR);
if (!is_array($input) || array_keys($input) !== ['sources', 'nonce']
    || !preg_match('/^[a-f0-9]{32}$/D', $input['nonce'] ?? '')
    || count($input['sources'] ?? []) !== 2) {
    throw new RuntimeException('Invalid approved bootstrap input');
}
$resultPath = '/tmp/arden-release-' . $input['nonce'] . '.json';
if (file_exists($resultPath)) {
    throw new RuntimeException('Preserve existing bootstrap result before retrying');
}
umask(0077);
$result = Illuminate\Support\Facades\DB::transaction(function () use ($input, $resultPath) {
    $sources = [];
    $teamId = null;
    foreach ($input['sources'] as $environment => $uuid) {
        if (!in_array($environment, ['staging', 'production'], true)
            || !is_string($uuid) || !preg_match('/^[a-z0-9]{8,64}$/D', $uuid)) {
            throw new RuntimeException('Invalid source resource');
        }
        $service = App\Models\Service::whereUuid($uuid)->firstOrFail();
        $team = $service->environment->project->team;
        if ($teamId !== null && $teamId !== $team->id) {
            throw new RuntimeException('Both approved resources must share the expected team');
        }
        $teamId = $team->id;
        $sources[$environment] = [
            'service_uuid' => $service->uuid,
            'project_uuid' => $service->environment->project->uuid,
            'environment_uuid' => $service->environment->uuid,
            'server_uuid' => $service->server->uuid,
            'destination_uuid' => $service->destination->uuid,
        ];
    }
    $settings = App\Models\InstanceSettings::get();
    $active = Laravel\Sanctum\PersonalAccessToken::query()
        ->where(fn ($query) => $query->whereNull('expires_at')->orWhere('expires_at', '>', now()))->count();
    if ($active !== 0 || $settings->is_api_enabled) {
        throw new RuntimeException('Existing API access must be reconciled before changing its allowlist');
    }
    $before = ['is_api_enabled' => $settings->is_api_enabled, 'allowed_ips' => $settings->allowed_ips];
    $owner = $team->members()->wherePivot('role', 'owner')->orderBy('users.id')->firstOrFail();
    $token = $owner->createToken('arden-release-local-' . $input['nonce'],
        ['read', 'read:sensitive', 'write', 'deploy'], now()->addDays(90), (int) $teamId);
    $settings->is_api_enabled = true;
    $settings->allowed_ips = '127.0.0.1,::1';
    $settings->save();
    $result = ['before' => $before, 'sources' => $sources, 'token' => $token->plainTextToken,
            'token_id' => $token->accessToken->id, 'expires_at' => now()->addDays(90)->toIso8601String()];
    // Persist recovery material before committing access changes. A write failure rolls back SQL.
    // If SQL commit later fails, this result remains for explicit reconciliation, never blind rotation.
    $output = fopen($resultPath, 'x');
    if (!$output) {
        throw new RuntimeException('Cannot create protected bootstrap recovery result');
    }
    try {
        $data = json_encode($result, JSON_THROW_ON_ERROR);
        if (fwrite($output, $data) !== strlen($data) || !fflush($output) || !fsync($output)) {
            throw new RuntimeException('Cannot persist bootstrap recovery result');
        }
    } finally {
        fclose($output);
    }
    return $result;
});
echo "Local management bootstrap prepared; retrieve the protected result.\n";
