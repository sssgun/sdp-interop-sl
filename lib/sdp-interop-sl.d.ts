declare module 'sdp-interop-sl' {
    export class InteropFF {
        constructor();

        getFirstSendingIndexFromAnswer(type: any): any;

        toPlanB(desc: any): any;

        toUnifiedPlan(desc: any): any;
    }

    export function InteropChrome(): any;

    export namespace transform {
        function parse(sdp: any): any;

        function write(session: any, opts?: any): any;

        namespace parse {
            const prototype: {};
        }

        namespace write {
            const prototype: {};
        }
    }
}
