export const getTeamId = (payload) => {
    if (payload.isEnterpriseInstall && payload.enterprise !== undefined) {
        return payload.enterprise.id;
    }
    if (payload.team !== undefined) {
        return payload.team.id;
    }
    if (payload.team_id !== undefined) {
        return payload.team_id;
    }
    else {
        console.error('Payload structure for getTeamId:', JSON.stringify(payload, null, 2));
        throw new Error('Could not find a valid team id in the payload request');
    }
}
