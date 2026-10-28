<?php
// Version-specific local adapter: use Coolify's own action and correlate its activity.
require '/var/www/html/vendor/autoload.php';
$app = require '/var/www/html/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

try {
    $input = json_decode(stream_get_contents(STDIN), true, 16, JSON_THROW_ON_ERROR);
    if (!is_array($input) || !in_array($input['op'] ?? '', ['start', 'status'], true)
        || !preg_match('/^[a-z0-9]{8,64}$/D', $input['service_uuid'] ?? '')) {
        throw new RuntimeException('Invalid operation');
    }
    $token = Laravel\Sanctum\PersonalAccessToken::findToken($input['token'] ?? '');
    if (!$token || ($token->expires_at && $token->expires_at->isPast()) || !$token->can('deploy')
        || !str_starts_with($token->name, 'arden-release-local-')) {
        throw new RuntimeException('Invalid local deployment capability');
    }
    $user = $token->tokenable->withAccessToken($token);
    Illuminate\Support\Facades\Auth::login($user);
    $service = App\Models\Service::whereUuid($input['service_uuid'])->firstOrFail();
    if ((int) $service->environment->project->team_id !== (int) $token->team_id) {
        throw new RuntimeException('Wrong resource team');
    }
    Illuminate\Support\Facades\Gate::authorize('deploy', $service);
    $compose = json_decode($service->docker_compose_raw, true, 32, JSON_THROW_ON_ERROR);
    $names = array_keys($compose['services'] ?? []);
    sort($names);
    if ($names !== ['arden-api', 'arden-web']) {
        throw new RuntimeException('Only app-only Services are eligible');
    }
    $directory = '/var/lib/arden-release-bridge';
    if (!is_dir($directory) || is_link($directory) || fileowner($directory) !== 0
        || (fileperms($directory) & 0077) !== 0) {
        throw new RuntimeException('Protected operation journal is unavailable');
    }
    $path = $directory . '/' . $service->uuid . '.json';
    $saveJournal = static function (array $value) use ($directory, $path) {
        $temporary = tempnam($directory, 'intent-');
        if ($temporary === false) {
            throw new RuntimeException('Cannot create operation journal');
        }
        try {
            chmod($temporary, 0600);
            $output = fopen($temporary, 'wb');
            if (!$output) {
                throw new RuntimeException('Cannot open operation journal');
            }
            try {
                $data = json_encode($value, JSON_THROW_ON_ERROR);
                if (fwrite($output, $data) !== strlen($data) || !fflush($output) || !fsync($output)) {
                    throw new RuntimeException('Cannot persist operation journal');
                }
            } finally {
                fclose($output);
            }
            if (!rename($temporary, $path)) {
                throw new RuntimeException('Cannot replace operation journal');
            }
        } finally {
            if (file_exists($temporary)) unlink($temporary);
        }
    };
    $journal = file_exists($path) ? json_decode(file_get_contents($path), true, 16, JSON_THROW_ON_ERROR) : null;
    $activityModel = config('activitylog.activity_model');
    $status = 'none';
    if ($journal) {
        if (!isset($journal['activity_id'])) {
            $candidates = $activityModel::where('properties->type_uuid', $service->uuid)
                ->where('id', '>', $journal['before_id'])->orderBy('id')->limit(2)->get();
            if ($candidates->count() !== 1) {
                echo json_encode(['status' => 'uncertain']);
                exit(0);
            }
            $journal['activity_id'] = $candidates->first()->id;
        }
        $activity = $activityModel::findOrFail($journal['activity_id']);
        if ($activity->getExtraProperty('type_uuid') !== $service->uuid) {
            throw new RuntimeException('Activity does not belong to the configured app');
        }
        $status = $activity->getExtraProperty('status');
    }
    if ($input['op'] === 'start' && in_array($status, ['none', 'finished', 'error', 'killed', 'cancelled'], true)) {
        $journal = ['before_id' => $activityModel::where('properties->type_uuid', $service->uuid)->max('id') ?? 0];
        umask(0077);
        $saveJournal($journal);
        $activity = App\Actions\Service\StartService::run($service, false, false);
        $journal['activity_id'] = $activity->id;
        $saveJournal($journal);
        $status = $activity->getExtraProperty('status');
    }
    echo json_encode(['status' => $status, 'activity_id' => $journal['activity_id'] ?? null], JSON_THROW_ON_ERROR);
} catch (Throwable $error) {
    // No token, command, activity logs, rendered config or exception chain escapes.
    echo '{"status":"unavailable"}';
    exit(1);
}
