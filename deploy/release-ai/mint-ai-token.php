<?php
// Operator-only helper: mint an isolated arden-release-ai-local-* Sanctum token
// without modifying Coolify's existing loopback API settings or Core's token.
require '/var/www/html/vendor/autoload.php';
$app = require '/var/www/html/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

$input = json_decode(stream_get_contents(STDIN), true, 16, JSON_THROW_ON_ERROR);
if (!is_array($input) || array_keys($input) !== ['services', 'nonce']
    || !preg_match('/^[a-f0-9]{32}$/D', $input['nonce'] ?? '')
    || !is_array($input['services'] ?? null)
    || count($input['services']) < 1 || count($input['services']) > 2) {
    throw new RuntimeException('Invalid approved AI token bootstrap input');
}
$resultPath = '/tmp/arden-release-ai-' . $input['nonce'] . '.json';
if (file_exists($resultPath)) {
    throw new RuntimeException('Preserve existing AI bootstrap result before retrying');
}
umask(0077);
Illuminate\Support\Facades\DB::transaction(function () use ($input, $resultPath) {
    $settings = App\Models\InstanceSettings::get();
    if (!$settings->is_api_enabled || trim((string) $settings->allowed_ips) !== '127.0.0.1,::1') {
        throw new RuntimeException('Coolify local loopback API allowlist must already be configured');
    }
    $services = [];
    $teamId = null;
    foreach ($input['services'] as $environment => $uuid) {
        if (!in_array($environment, ['staging', 'production'], true)
            || !is_string($uuid) || !preg_match('/^[a-z0-9]{8,64}$/D', $uuid)) {
            throw new RuntimeException('Invalid AI service resource');
        }
        $service = App\Models\Service::whereUuid($uuid)->firstOrFail();
        $compose = json_decode($service->docker_compose_raw, true, 32, JSON_THROW_ON_ERROR);
        $names = array_keys($compose['services'] ?? []);
        sort($names);
        if ($names !== ['arden-ai']) {
            throw new RuntimeException('Target Coolify Service must contain only arden-ai');
        }
        $team = $service->environment->project->team;
        if ($teamId !== null && $teamId !== $team->id) {
            throw new RuntimeException('Approved AI services must share the expected team');
        }
        $teamId = $team->id;
        $services[$environment] = [
            'service_uuid' => $service->uuid,
            'project_uuid' => $service->environment->project->uuid,
            'environment_uuid' => $service->environment->uuid,
            'server_uuid' => $service->server->uuid,
            'destination_uuid' => $service->destination->uuid,
        ];
    }
    $owner = $team->members()->wherePivot('role', 'owner')->orderBy('users.id')->firstOrFail();
    $token = $owner->createToken(
        'arden-release-ai-local-' . $input['nonce'],
        ['read', 'read:sensitive', 'write', 'deploy'],
        now()->addDays(90),
        (int) $teamId
    );
    $result = [
        'services' => $services,
        'token' => $token->plainTextToken,
        'token_id' => $token->accessToken->id,
        'expires_at' => now()->addDays(90)->toIso8601String(),
    ];
    $output = fopen($resultPath, 'x');
    if (!$output) {
        throw new RuntimeException('Cannot create protected AI bootstrap recovery result');
    }
    try {
        $data = json_encode($result, JSON_THROW_ON_ERROR);
        if (fwrite($output, $data) !== strlen($data) || !fflush($output) || !fsync($output)) {
            throw new RuntimeException('Cannot persist AI bootstrap recovery result');
        }
    } finally {
        fclose($output);
    }
});
echo "Local AI management token prepared; retrieve the protected result.\n";
