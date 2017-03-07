/// <reference types="es6-promise" />
/// <reference types="node" />
import * as events from "events";
import * as asg from 'autoscalable-grid';
export declare type WorkerKey = string;
export interface IGridAutoScaler {
    readonly Scaling: boolean;
    Enabled: boolean;
    readonly HasWorkersCap: boolean;
    MaxAllowedWorkers: number;
    readonly LaunchingWorkers: WorkerKey[];
    readonly TerminatingWorkers: WorkerKey[];
}
export interface IAutoScalerImplementation {
    TranslateToWorkerKeys: (workerIdentifiers: asg.WorkerIdentifier[]) => Promise<WorkerKey[]>;
    ComputeWorkerDebt: (state: asg.IAutoScalableState) => Promise<number>;
    Terminator: (workerKeys: WorkerKey[]) => Promise<any>;
    Launcher: (numInstance: number) => Promise<WorkerKey[]>;
    readonly JSON: Promise<any>;
}
export interface IGridAutoScalerWithImpl extends IGridAutoScaler {
    ImplementationJSON: any;
}
export interface Options {
    EnabledAtStart?: boolean;
    MaxAllowedWorkers?: number;
    PollingIntervalMS?: number;
    TerminateWorkerAfterMinutesIdle?: number;
}
export declare class GridAutoScaler extends events.EventEmitter implements IGridAutoScaler {
    private scalable;
    private implementation;
    private options;
    private __enabled;
    private __MaxAllowedWorkers;
    private __terminatingWorkers;
    private __launchingWorkers;
    constructor(scalable: asg.IAutoScalableGrid, implementation: IAutoScalerImplementation, options?: Options);
    readonly Scaling: boolean;
    readonly LaunchingWorkers: WorkerKey[];
    readonly TerminatingWorkers: WorkerKey[];
    Enabled: boolean;
    readonly HasWorkersCap: boolean;
    MaxAllowedWorkers: number;
    private getTerminatePromise(toBeTerminatedWorkers);
    private getDownScalingPromise(state);
    private getUpScalingWithTaskDebtPromise(state);
    private getUpScalingPromise(state);
    private feedLastestWorkerStates(workerStates);
    private readonly AutoScalingPromise;
    private readonly TimerFunction;
    readonly ImplementationJSON: Promise<any>;
    toJSON(): IGridAutoScaler;
}
